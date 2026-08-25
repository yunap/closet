perl: warning: Setting locale failed.
perl: warning: Please check that your locale settings:
	LC_ALL = "C.UTF-8",
	LC_CTYPE = "C.UTF-8",
	LANG = "C.UTF-8"
    are supported and installed on your system.
perl: warning: Falling back to the standard locale ("C").
# Spec — Closet architecture ownership and consolidation pass

**Status:** Active — Stage 1 and Slice 0 complete; Slice 2 complete; Slices 1 and 3 in progress as
of 2026-08-24. Production consolidation proceeds one reviewed semantic contract at a time, with
unresolved behavior rulings still required before their owning slice changes runtime behavior.

**Audit baseline:** `c1693a8e8f76881d5cb3d87c173ea21fed6ccb53` (2026-08-24, PR 253 main).
This commit contains the selected-piece category-starvation fix, the current visual-composer
base-layer prompt rule, and the canonical domain vocabulary. Reconfirm and record the baseline SHA
if the base changes again; do not silently substitute another branch or commit.

**Authority:** This document proposes work. Current behavior remains governed by code and the
ratified documents routed from [README.md](README.md). In particular, this document must not
become a fourth behavioral map alongside [engine-behaviour-map.md](engine-behaviour-map.md), the
[flow atlas](flows/README.md), and [message-lifecycle.md](message-lifecycle.md).
Canonical domain terms come from [CONTEXT.md](CONTEXT.md); exact code symbols and historical UI
labels retain their source spelling when cited.

---

## 1. Goal

Reduce architectural fragmentation without redesigning product behavior.

For every shared domain responsibility in Closet, establish:

1. the semantic contract — the exact question being answered;
2. the authoritative fact reader or verdict owner;
3. every active consumer;
4. which differences are deliberate flow strategy or disposition;
5. which implementations are duplicate or superseded;
6. how a future parallel implementation will be caught.

Ownership is not complete when several implementations merely agree on paper. For responsibilities
that execute in more than one flow, the end state is **one reusable runtime implementation** with
flow policy passed as data. Documentation, naming, and test parity are supporting controls; they do
not substitute for reuse. A shared fact reader followed by five independently assembled gate,
truncation, validation, or fallback pipelines is still fragmented architecture.

The pass is successful when a behavior question such as:

> Can this piece satisfy this role in this context?

has one authoritative meaning, even when selected-piece, whole-wardrobe, freeform, and capsule
flows make different strategic choices with the answer.

This is an architecture-remediation task, not a Stylist feature redesign.

---

## 2. Non-negotiable first instruction

> **Do not begin by refactoring. First produce the responsibility census, flow pipeline maps, and
> proposed ownership decisions. Stop for owner review before changing production behavior or moving
> code.**

Stage 1 is read-only except for its documentation and diagnostic artifacts. A suspected duplicate
is a finding, not permission to consolidate it.

---

## 3. Terms

### Fact

Stored or derived piece/context evidence: `needs_base`, `fit_on_body`, opacity, category,
weather evidence, activity, owner constraints, and similar inputs.

### Semantic contract

One narrowly stated domain question and its result shape. Examples:

```text
Can this top independently provide opaque torso coverage?
Can candidate A physically sit under dependent piece B?
Does this roster preserve at least one complete outfit structure?
```

A shared concept needs one authoritative semantic contract. It does not necessarily need one giant
function. A valid ownership chain may be:

```text
field definition
→ normalized attribute reader
→ verdict primitive
→ flow-specific policy
```

### Invariant

A meaning or hard-validity rule that must not change by flow.

### Strategy

A flow-specific objective applied after shared facts and invariants: anchor relevance, broad
exploration, capsule recombination, recency, or a finite photo budget.

### Disposition

What a flow does after receiving a verdict: reject, annotate, retry, repair, complete, disclose a
gap, or fall back. Dispositions may legitimately differ while consuming the same verdict.

### Projection

A serialization of facts for a model, tool, UI, log, or response. A projection is not the owner of
the facts it transmits.

---

## 4. Classification model

Classify each **decision surface per responsibility**, not each function globally. A large function
may be canonical for one decision, orchestration for another, and duplicate for a third.

Use:

- `canonical` — authoritative owner of the semantic contract;
- `specialization` — adds flow-specific strategy while delegating shared meanings;
- `adapter/orchestration` — connects owners and controls sequence without redefining them;
- `projection/serialization` — transmits canonical facts without deciding their meaning;
- `duplicate` — independently reimplements a shared semantic contract;
- `legacy` — superseded and removable after caller migration;
- `unresolved` — Stage 1 only, with the evidence and owner decision required.

No `unresolved` classification may enter a consolidation slice. It is acceptable in the first
census precisely so uncertain intent is surfaced rather than guessed.

---

## 5. Documentation boundary

Create `docs/architecture-responsibility-census.md` as an **ownership index**, not a restatement of
the behavioral maps.

It may summarize the ownership conclusion, but detailed behavior remains in the matching authority:

| Question | Existing authority |
|---|---|
| gates, scores, ceilings, retry and fallback behavior | `docs/engine-behaviour-map.md` |
| model-facing flow sequence | `docs/flows/*.md` |
| `/ask` dispatch, tool loop, output guards and state handoff | `docs/message-lifecycle.md` |
| piece field meaning and population | `docs/garment-field-reference.md` |
| feedback stores and authority | `docs/feedback-and-memory-map.md` |
| `/ask` prompt/tool instruction ownership | `docs/freeform-prompt-ownership.md` |
| capsule product behavior | `docs/capsule-current-behaviour.md` and capsule index |

The census links to these documents and records ownership, consumers, specialization, duplication,
and migration status. If consolidation changes behavior, amend the matching existing map inline and
dated in the same commit. Cite code by file and function name, never line number.

Before the provider census is called complete, add the two currently missing flow-atlas entries for
`/expand-capsule` and `/repair-capsule-look`. Do not copy all provider diagrams into the census.

---

## 6. Stage 1 deliverables

### 6.1 Responsibility census

For every responsibility, use this shape:

```text
Responsibility: Roster structural coverage

Semantic contracts:
- Given eligible pieces, required outfit structures, protected anchors and a hard capacity,
  return a covered roster or an explicit unsatisfied-coverage result.

Decision surfaces:
- function / branch — file
  - decision made
  - classification for this responsibility
  - callers

Consumers:
- selected-piece visual generation
- whole-wardrobe visual generation
- freeform bounded generation
- freeform serial proposal
- capsule planning
- capsule expansion / repair
...

Shared invariants:
- no silent category starvation before composition
- protected anchors survive
- impossible coverage is disclosed rather than fabricated

Intentional strategy:
- selected-piece anchor relevance
- whole-wardrobe breadth and recency
- capsule finite-budget recombination

Suspected duplication:
- ...

Unresolved:
- evidence and owner decision required

Proposed owner:
- contract owner, not merely destination filename

Existing tests and observability:
- ...
```

Enumerate from production entry points and actual imports/callers. Grep is a discovery tool, not
proof of reachability. Trace route registration, client entry, tool dispatch, nested provider calls,
fallbacks, and response assembly. Record inactive exports separately from active consumers.

### 6.2 Pipeline maps

For every active outfit-producing flow, map:

```text
source wardrobe / current outfit
↓
context resolution
↓
eligibility
↓
ranking
↓
roster or retrieval construction
↓
composition
↓
validation
↓
disposition: repair / completion / retry / annotation
↓
fallback or gap disclosure
↓
response assembly and persistence
```

At minimum trace:

- selected-piece visual composer;
- selected-piece text/ideal branch;
- whole-wardrobe Visual Composer;
- saved-outfit Similar and Creative variants;
- piece concept-board generation where it produces outfit directions;
- `/ask` serial `search_wardrobe` → `propose_outfit`;
- `/ask` bounded `generate_outfits`;
- `/ask` `plan_outfit_set` → `submit_plan_outfits`;
- atomic capsule composition;
- `/expand-capsule`;
- `/repair-capsule-look`;
- every deterministic backfill and absolute fallback reachable from those flows.

Two flows reaching the same composer is not complete reuse if they independently change candidate
population before it or weaken validation after it.

### 6.3 Proposed ownership decisions

For each shared contract, propose:

- canonical owner and result shape;
- fact inputs and missing-data semantics;
- allowed configuration versus forbidden reimplementation;
- consumer migration list;
- old decision surfaces to delete;
- behavior fixtures that must remain unchanged;
- owner rulings required before implementation.

Then stop for review.

---

## 7. Responsibilities in scope

The named functions below are seeds, not an exhaustive inventory.

### 7.1 Piece-fact ownership and projections

Audit separately:

1. field definition and accepted vocabulary;
2. persistence and tagging;
3. structured readers and text fallbacks;
4. domain verdicts;
5. prompt/tool/UI serialization.

`styling-engine/attributes.js` is the only allowed place to interpret piece text. Functions such
as `composerPieceLineSuffix()`, `buildPieceText()`, wardrobe manifest builders, and tool result rows
are projections; they must not independently define piece meaning.

Include the known live split between `attributePieceTextBlob()` and `pieceTextBlob()`, already
recorded in `docs/cleanup-inventory.md`, and determine whether it is a deliberate projection
difference, a rename requirement, or duplicate interpretation.

### 7.2 Eligibility and hard gates

Inspect:

- `wholeWardrobePieceTrustDecision()`;
- `filterWholeWardrobePiecesForGeneration()`;
- `buildVisualComposerRoster()`;
- `profileRuleFit()` and its verdict primitives;
- `search_wardrobe` filtering and supply-aware broadening;
- `propose_outfit` hard gates and anchor bypass;
- capsule slot eligibility;
- selected-piece candidate eligibility;
- request-specific exclusions and owner constraints.

Do not start from the assumption that these are all duplicates. Current code already delegates many
flows to `wholeWardrobePieceTrustDecision()`, while the visual roster intentionally applies stricter
metadata completeness, supply-aware activity/register gates, photo availability, and image-budget
policy. Classify each decision inside the caller.

The census must explicitly distinguish:

- hard invalidity;
- unknown metadata;
- supply-aware relaxation with disclosure;
- anchor override;
- soft preference or score;
- roster-only photo/cap policy.

### 7.3 Candidate ranking

Inspect:

- `compatibilityScoreForSelectedItem()`;
- `rankedComplementaryWardrobeFor()`;
- `selectCandidatesForOutfitGeneration()`;
- `buildVisualComposerRoster()` relevance scoring;
- `capsuleVersatilityScore()`;
- `selectPlanWorkbenchPieces()`;
- `search_wardrobe` rule-fit, weather-fit, and activity ordering;
- slot-swap ranking;
- whole-wardrobe candidate and diversity scoring.

Do not consolidate different objectives into one universal score. The shared requirement is that
scores consume the same facts and hard verdicts, remain observable, and do not perform hidden
eligibility decisions.

Any implemented scoring or attribute-classification change requires the repository's ranking A/B
diff procedure. A code move that claims to preserve behavior must demonstrate a zero diff or explain
every difference.

### 7.4 Roster and retrieval construction

Inspect:

- `selectCandidatesForOutfitGeneration()`;
- `buildVisualComposerRoster()`;
- `search_wardrobe` result construction and per-category visual budget;
- `selectCapsuleRoster()`;
- `buildCapsuleBench()`;
- `selectCapsuleRosterViaModel()`;
- `buildPlanSlotWorkbench()` and per-slot workbench limits;
- any fallback that selects pieces directly.

Define a shared **structural coverage contract** with explicit inputs:

```text
eligible candidates
+ required outfit structures
+ protected anchor ids
+ dependency requirements
+ hard capacity
→ covered selection | explicit coverage shortfall
```

The contract must not assume one fixed category list. A valid core may be top + bottom + shoes or
dress + shoes; a dependent piece may introduce a base requirement; outerwear and accessories may
be optional; a capsule may need several contexts under one finite budget.

A ranking or truncation step must not silently remove every candidate needed for a structure when
eligible supply exists. When hard capacity makes coverage impossible, the result must identify the
unsatisfied structure and the caller must disclose or stop; it must not fabricate, overflow a hard
provider limit, or continue as though the roster were complete.

### 7.5 Layering and base-layer contracts

Do not define one vague `compatibleBase` boolean. Audit and assign separate owners for:

1. **Dependent status:** does this piece require another piece beneath it?
2. **Coverage eligibility:** can this candidate independently provide usable coverage?
3. **Pair mechanics:** can this candidate physically sit under this particular dependent piece?
4. **Layer direction:** is top-over-dress, top-under-dress, or another relationship supported by
   structured piece evidence?
5. **Visual judgment:** do the actual neckline, bulk, color, texture, and proportions work together?
6. **Sight requirement:** must the model inspect one or both photos before accepting the pairing?

Verified current decision surfaces include:

- `pieceReadsAsStandaloneBaseTop()` for freeform role validation;
- capsule-local `pieceNeedsBase()` and `isCapsuleBaseCandidate()`;
- `pieceHasExplicitTopLayerEvidence()`, `pieceHasExplicitBaseLayerEvidence()`, and
  `pieceDressSupportsUnderlayer()`;
- `evaluateOutfitRoles()`;
- `validateSubmittedPlanOutfits()`;
- `capsuleOutfitCoreCapacity()` and capsule roster postconditions;
- the fit-specific base rule in `WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM`;
- `buildLocalFallbackOutfitDirections()`, which currently only deprioritizes dependent pieces;
- `repairWholeWardrobeOutfit()`, which currently has no general base-layer repair.

A deterministic verdict should return `compatible`, `incompatible`, or `unknown`, plus structured
reason/evidence. Missing metadata semantics must be explicit. Code should decide construction facts;
the model should judge visual success from supplied facts and images.

### 7.6 Composition constraints

Inventory constraints across:

- `WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM` and selected-anchor additions;
- `OUTFIT_COMPOSER_SYSTEM` and evaluator gate;
- freeform tool roles and `evaluateOutfitRoles()`;
- capsule roster/composition prompts;
- plan slot contracts;
- saved-variant contracts;
- local candidate generation.

Classify every rule as:

```text
domain invariant
flow-specific composition strategy
conversation behavior
presentation/output contract
```

A domain invariant should originate from canonical code/data and be projected into each prompt that
needs it. Do not maintain independently worded definitions of the same construction fact. Do not
merge all prompts.

### 7.7 Outfit validation

Inspect:

- `locallyGateOutfitDirections()`;
- `sanitizeSelectedPieceOutfitDirections()`;
- category-core validation (now `evaluateOutfitStructure()`);
- `locallyGateWholeWardrobeOutfits()` in both `gate` and `advisor` modes;
- `evaluateOutfitRoles()`;
- `validateCapsuleRoster()`;
- `validateSlotOutfitConstraints()`;
- `validateSubmittedPlanOutfits()`;
- direct route-level structural filters and visual-clash review.

Separate shared verdicts from flow disposition. For example, whole-wardrobe advisor mode may
annotate a concern that gate mode rejects, but both must agree on the underlying fact. Preserve the
ratified rule that whole-wardrobe advisor mode does not mechanically reinvent a model composition.

### 7.8 Repair, completion, retry, and fallback

Inspect:

- `repairWholeWardrobeOutfit()`;
- `applyComfortFootwearRepair()`;
- `completeSubmittedPlanOutfits()`;
- capsule repair and expansion routes;
- selected-piece sanitization and merging;
- `buildLocalFallbackOutfitDirections()`;
- whole-wardrobe local backfill and diagnostic cards;
- the selected-piece absolute basic backfill;
- provider retry/output-check fallbacks.

The census must describe what each function actually changes. Names are not evidence: current
`repairWholeWardrobeOutfit()` primarily preserves/rewrites prose and may substitute a required shoe;
it is not a general structural completion engine.

Every fallback must consume the same hard verdicts as its primary path, or document a reviewed
exception and surface it to the user. Fallbacks may reduce ambition, variety, or aesthetic judgment;
they may not silently weaken owner constraints, weather/activity validity, structure, dependency
requirements, or ID ownership.

### 7.9 Prompt ownership

Extend the existing `/ask` prompt-ownership method to the non-tool composers without copying its
table wholesale. Track each invariant's source and projections. Preserve prompt-cache boundaries and
the Style Constitution interpolation requirements.

Prompt consolidation is complete only when tests prove the surviving owner still reaches every
consumer that needs the rule. Moving wording out of a prompt is not success if the model loses the
fact or the mechanical validator does not consume it.

### 7.10 Provider execution and telemetry

Use the flow atlas as the primary provider-call census. Fill its two known capsule-route gaps and
verify every active execution site, including nested composers, direct Responses/image calls,
importer calls, and feedback synthesis.

Provider consolidation, model changes, and token optimization are out of scope. This responsibility
exists to ensure a domain consolidation does not leave an untraced expensive path or bypass
telemetry. A slice only needs to change provider ownership when the census proves a correctness or
observability defect.

### 7.11 Conversation state

Audit authority **per field**, not per state object, across:

- `stylist_conversation_state` through `getStylistConversationState()` and
  `saveStylistConversationState()`;
- `buildStylistConversationPayload()` and structured `threadState`;
- ephemeral `toolContext` mutation inside one tool loop;
- current outfit sets returned to the client;
- browser-supplied history/context echoes and their documented fallback status;
- bounded-router compact state.

For occasion, activity, season, weather profile, current outfit set, active outfit, pending plan,
and verified/seen-piece state, record:

- writer;
- persistence lifetime;
- conflict precedence;
- consumer;
- whether the value is authoritative, fallback, or display-only.

Do not redesign conversation state in the same slice as piece/roster consolidation unless the
census proves the same semantic contract is directly blocked by state divergence.

---

## 8. Verified starting findings — hypotheses, not final rulings

These findings seed the census and prevent rediscovery. They do not authorize a fix.

1. **Eligibility is partially consolidated.** `wholeWardrobePieceTrustDecision()` is already called
   by selected-piece ranking, whole-wardrobe filtering, several freeform tools, plan construction,
   repair, and local candidate scoring. `buildVisualComposerRoster()` still adds photo, metadata,
   supply-aware register/activity, weather, and cap decisions.
2. **Roster coverage exists in several shapes.** Selected-piece candidates use category quotas;
   the 2026-08-24 fix moved truncation after full ranking. The visual roster uses category ceilings
   followed by a global cap. Capsule selection uses quotas, reserve passes, postconditions, and
   explicit gaps; the capsule bench seeds from the deterministic roster and protects categories and
   slots. Freeform search protects its image budget per category but is a retrieval surface, not a
   finite outfit roster.
3. **Base-layer meaning is split.** Freeform role validation uses a text-derived standalone-top
   predicate; capsule coverage uses structured `needs_base` and opacity; the visual-composer prompt
   additionally requires close `fit_on_body` values for pair mechanics. These answer related but
   non-identical questions and currently have no shared pair verdict.
4. **Structural validation is not one layer.** Category-core validation is shared by several
   selected/whole/plan paths, while freeform cards use explicit roles through
   `evaluateOutfitRoles()`, capsule submission adds slot/set rules, and
   `locallyGateOutfitDirections()` checks only anchor presence, minimum count, and duplication.
5. **Disposition is intentionally different.** Whole-wardrobe advisor mode annotates many findings
   and avoids repair; selected-piece visual generation repairs and filters; capsule bounded
   composition completes omissions before validation; freeform serial composition retries and shows
   rejected attempts as needs-review cards.
6. **Fallback parity is incomplete by construction.** The selected-piece local fallback has no
   general layering model and the absolute basic backfill selects leading ranked supports without a
   shared full-outfit validator. These are high-priority census targets, not proof that their current
   output should be deleted.
7. **Conversation state has multiple lifetimes.** Persistent server state, ephemeral tool-loop
   state, structured prompt state, current response cards, and browser history all coexist with
   documented precedence but do not form one interchangeable store.

---

## 9. Consolidation protocol after Stage 1 approval

Work in one semantic contract per slice.

1. Pin the approved baseline and current behavior fixtures.
2. State the contract and missing-data semantics.
3. Identify the canonical owner and allowed configuration.
4. Get owner confirmation for any behavior difference or ratified exception.
5. Add canonical unit tests before migrating callers.
6. Migrate every named consumer in the slice.
7. Delete superseded logic in the same slice; do not defer deletion to a final cleanup phase.
8. Add thin integration tests for each consumer using shared fixture builders.
9. Update the existing behavioral and flow documents in the same commit.
10. Run the full offline suite and any required ranking A/B diff.

Avoid compatibility wrappers unless a concrete staged migration requires one. Record the removal
condition and deadline beside any temporary wrapper.

### Deep-module gate for every slice

A shared filename or helper is not consolidation. Each proposed runtime owner must earn its place
as a **deep module**: callers learn a small interface while the implementation absorbs the domain
work that was previously scattered across flows. Apply this gate before production code is added:

1. **Deletion test:** if the module disappeared, would its complexity reappear in multiple active
   callers? If the complexity would simply vanish, the proposal is shallow indirection.
2. **Interface depth:** the interface names the domain question and stable policy inputs; it does
   not expose the implementation's internal sequence, intermediate helpers, or a bag of switches
   mirroring every old branch.
3. **Leverage:** at least two active consumers receive substantial behavior from the same
   implementation. Similar naming or output parity does not count.
4. **Locality:** the decision, reason codes, missing-data semantics, and direct verification live
   with the module instead of remaining distributed among callers.
5. **Real seams only:** add an adapter where two real implementations are required. Test-only
   substitution for time, weather, or another external dependency stays at an internal seam and
   does not enlarge the production caller interface.
6. **Interface as test surface:** canonical contract tests and production callers cross the same
   seam. Tests do not reach past the interface to preserve old helper structure.
7. **Replace, do not layer:** migrate the named consumers and delete the superseded decision
   surfaces in the same slice. A temporary compatibility adapter requires an explicit removal
   condition and may not become the permanent architecture.

Policy callbacks are not an automatic escape hatch. If a caller must reproduce context
precedence, eligibility order, coverage bookkeeping, validation sequencing, or recovery safety in
order to configure the module, the implementation is still fragmented and the interface is too
shallow.

Suggested implementation sequence, subject to the Stage 1 census:

1. one normalized styling-context builder used by every outfit-producing entry point;
2. one executable eligibility pipeline, with explicit anchor/photo/supply policy inputs;
3. one structured outfit-validation pipeline, with flow-specific disposition applied afterward;
4. one reusable candidate-set pipeline that accepts a ranking strategy and preserves required
   structure through hard caps;
5. shared validated recovery primitives for substitution, completion, fallback, and gap disclosure;
6. prompt and response projections sourced from the shared runtime results;
7. provider and state guardrails, followed by final ratchets for implementations already retired
   inside their owning slices.

Layer/base behavior is a required cross-flow fixture for steps 2–5, not the organizing axis of the
migration. The pass must also prove reuse for unrelated occasion, activity, weather, owner-rule,
category-coverage, and footwear cases so success cannot mean “the latest layering bug is fixed.”

---

## 10. Test strategy

### Canonical contract tests

Test each shared verdict directly, including `unknown` and missing-data behavior. A fixture should be
falsifiable from structured data without a model call.

### Consumer integration tests

Use shared fixture factories, then one thin test per consumer proving it delegates to the canonical
runtime stage. Output parity is necessary for migration safety but is not proof of reuse. Do not
create one enormous test that couples every pipeline.

Required coverage includes:

- the same resolved context and underlying findings reach every flow for equivalent inputs;
- approved flow differences appear as policy/disposition inputs, not separate computations;
- category/structure coverage survives global ranking and truncation where capacity permits;
- selected-piece, whole-wardrobe, bounded generation, and capsule consumers preserve their approved
  structure requirements;
- one base-layer fixture matrix exercises coverage eligibility, pair mechanics, unknown metadata,
  and sight requirements across relevant consumers;
- primary and fallback paths agree on hard constraints;
- anchor bypass is explicit and identical where ratified;
- impossible supply produces a surfaced shortfall rather than silent weakening;
- provider execution remains offline/mocked and telemetry attribution remains present.

### Architecture ratchets

Do not claim that a generic test can detect all future semantic duplication in JavaScript. Use
narrow mechanical ratchets:

- retired symbol names stay absent;
- active entry points import, inject, or receive the canonical stage where that dependency is
  observable;
- retired context, gate, validator, truncation, and fallback branches stay absent;
- prompt projections contain the canonical serialized rule where required;
- a maintained inventory lists every known decision surface and classification;
- docs health catches stale function citations and broken links.

If a formal registry is proposed solely to make an architecture test possible, it must pass the
repository's “new structure earns its keep” test before introduction.

### Verification commands

- `npm test` — full offline deterministic suite;
- `node scratch/rankings_ab_diff.js` when scoring or attribute classification changes;
- relevant tracked diagnostics against a **copy** of the real database, never the live database;
- no paid model or image calls.

Every ranking difference must have an `EXPLAINED BY` attribution. A purported no-op consolidation
with an unexplained behavioral diff is not complete.

---

## 11. Explicitly out of scope

Do not:

- change styling taste or the Style Constitution;
- redesign Stylist UX;
- force all flows through `/ask`;
- merge selected-piece and whole-wardrobe orchestration;
- turn capsule into ordinary outfit generation;
- replace model judgment with keyword taste rules;
- change models or providers;
- optimize token cost except where deletion naturally removes duplicate payload;
- rewrite working code for naming or aesthetic consistency alone;
- redesign feedback storage or conversation state without separate evidence and owner approval;
- run paid batch, model, vision, or image-generation calls.

No UI redesign is authorized by this spec. If implementation later materially changes a user-facing
surface, the mandatory UI expert-panel process applies separately.

---

## 12. Stage gates and acceptance

### Stage 1 acceptance — stop here for owner review

1. Baseline SHA is recorded.
2. Every major responsibility has its active decision surfaces and callers enumerated.
3. Every decision surface has a per-responsibility classification or an explicit unresolved owner
   question.
4. Every outfit-producing flow has a complete pipeline map including fallback and response
   assembly.
5. Proposed owners distinguish facts, verdicts, strategy, disposition, and projection.
6. The migration plan ranks shared executable stages by live-flow reach and behavioral divergence,
   rather than by the recency of the bug that triggered the audit.
7. Existing ratified differences are cited rather than inferred away.
8. The two missing capsule provider-flow diagrams are filled.
9. No production behavior has changed.

### Final remediation acceptance

1. Every shared semantic contract has one documented owner.
2. Every active consumer is enumerated and delegates shared decisions to that owner.
3. Intentional flow differences are named as strategy or disposition and covered by tests.
4. Shared hard invariants are implemented once, or carry an explicit owner-approved exception.
5. Roster truncation cannot silently starve required structure when eligible supply and capacity
   exist.
6. Layer/base contracts distinguish dependent status, coverage, pair mechanics, direction, sight,
   and visual judgment.
7. Repair, completion, retry, and fallback paths cannot silently bypass shared hard constraints.
8. Superseded implementations are deleted in their migration slices.
9. Prompt projections trace back to canonical facts/contracts without independently redefining
   them.
10. Provider execution and telemetry inventory remains complete.
11. Conversation-state authority is documented per field and lifetime.
12. All tests and required A/B diffs pass without paid calls or unexplained behavior changes.
13. Shared ownership is executable: active consumers call the same implementation for each shared
    stage, and superseded parallel implementations are deleted rather than left in parity by
    convention.
