perl: warning: Setting locale failed.
perl: warning: Please check that your locale settings:
	LC_ALL = "C.UTF-8",
	LC_CTYPE = "C.UTF-8",
	LANG = "C.UTF-8"
    are supported and installed on your system.
perl: warning: Falling back to the standard locale ("C").
# Closet architecture responsibility census

**Status:** Active — Stage 1 census approved 2026-08-24; Slice 0 baseline complete. Proposed
ownership decisions marked unresolved still require the named owner ruling before implementation.

**Audit baseline:** `c1693a8e8f76881d5cb3d87c173ea21fed6ccb53` (2026-08-24, PR 253 main).

**Scope:** Active outfit-producing paths and the shared responsibilities named in
[architecture-ownership-consolidation-spec.md](architecture-ownership-consolidation-spec.md).
This is an ownership index. Detailed current behavior remains in
[engine-behaviour-map.md](engine-behaviour-map.md), the [flow atlas](flows/README.md),
[message-lifecycle.md](message-lifecycle.md),
[garment-field-reference.md](garment-field-reference.md), and the
[capsule index](capsule-index-and-plan.md).
Domain language follows [CONTEXT.md](CONTEXT.md); exact code symbols, database fields, routes, and
historical UI labels retain their source spelling when cited.

**Method:** Production routes were traced from client calls through route registration, nested
composer calls, validation, repair, fallback, response assembly, and state persistence. Exports
found by search but not reached by an active entry point are not counted as consumers. Function
names below are citations; line numbers are deliberately omitted because they rot.

---

## 1. Outcome

Closet has reusable low-level readers and verdict helpers, but it does not yet have a reusable
outfit-production pipeline. Each major flow assembles its own sequence of context resolution,
eligibility, ranking, truncation, composition, validation, recovery, and response handling. Even
when two flows call the same fact reader, they can diverge before or after that call and produce
different behavior from the same wardrobe and context.

That is not merely a maintenance problem. Parallel runtime paths mean:

- a fixed rule reaches some products but not others;
- a fallback can bypass a constraint enforced by the primary path;
- tests prove one implementation while another remains wrong;
- missing context is resolved differently before the same shared gate runs;
- hard caps remove different structural supply from equivalent requests;
- telemetry cannot compare flows at the same stage because their stage boundaries differ.

The architecture target is therefore **shared executable stages with flow policy passed as data**.
Selected-piece, whole-wardrobe, freeform, and capsule remain distinct products, but their
orchestrators should call the same context, eligibility, candidate-set, validation, and recovery
implementations. Strategy may vary; fundamental work should not be reimplemented.

Layer/base behavior is one high-value fixture because it currently crosses every stage. It is not
the center of the architecture and should not determine the migration order. The same reuse must be
proven with unrelated occasion, weather, activity, owner-constraint, footwear, and category-supply
fixtures.

---

## 2. Classification legend

| Classification | Meaning in this census |
|---|---|
| `canonical` | Current authoritative owner of a narrow fact or verdict. |
| `specialization` | Legitimate flow strategy layered on shared meanings. |
| `adapter` | Orchestration, sequencing, or response assembly without owning the meaning. |
| `projection` | Serialization for a model, tool, UI, log, or response. |
| `duplicate` | Independent implementation of the same semantic question. |
| `legacy` | Active or reachable superseded behavior that should be removed after migration. |
| `unresolved` | Intent or missing-data semantics require an owner ruling before code changes. |

A function can have different classifications for different decisions. For example,
`buildVisualComposerRoster` is a specialization for photo-budget policy, an adapter for several
shared verdicts, and unresolved where it independently restates a policy that resembles the trust
gate.

---

## 3. Active outfit-producing pipelines

This matrix is the compact ownership view. The linked flow documents remain the sequence
authority.

| Flow | Source and context | Eligibility / ranking / bounded set | Composition | Validation and disposition | Fallback / response |
|---|---|---|---|---|---|
| Selected-piece visual composer | Active anchor, active wardrobe, occasion/season/activity/weather, piece memory | `selectAutomaticUseCandidatesForOutfitGeneration` injects shared findings into the selected score/category-quota strategy, then `evaluateVisualComposerPiecePool` applies visual policy with the anchor protected | `composeSelectedPieceVisualWardrobeOutfits`, one visual composer call | `locallyGateWholeWardrobeOutfits`, `sanitizeSelectedPieceOutfitDirections`, then `applyComfortFootwearRepair`; selected anchor must survive | `buildLocalFallbackOutfitDirections`, then absolute basic backfill; returned as structured outfit cards. See [selected-piece-composer.md](flows/selected-piece-composer.md). |
| Selected-piece text / ideal edge branch | Same anchor and memory; free-text route can enable `idealMode` | Same selected candidate rank; optional `rankSelectedPieceCandidatesWithVision` reorders | `composeStructuredOutfitsForPiece` may suggest missing pieces | `locallyGateOutfitDirections`, optional evaluator gate, selected sanitization | Local fallback and absolute backfill preserve non-empty response. See [selected-piece-composer.md](flows/selected-piece-composer.md). |
| Piece concept boards | Selected piece plus supplied structured outfits or concept text | `selectAutomaticUseCandidatesForOutfitGeneration` with a larger support limit; allowed IDs fixed before planning | Reuses supplied structured outfits, parses concept text, or calls the board planner once; then image rendering per accepted board | ID allowlist, selected-anchor insertion, dedupe, minimum two pieces; no full shared outfit validator | Unusable boards are skipped; zero usable boards is an error. See [piece-concept-boards.md](flows/piece-concept-boards.md). |
| Whole-wardrobe Visual Composer | Active wardrobe plus resolved request/occasion/activity/season/weather and recent-memory context | `evaluateAutomaticUsePiecePool` with saved-Main/hot-outerwear policy, then `evaluateVisualComposerPiecePool` and visual relevance/caps | Whole-wardrobe visual composer | `locallyGateWholeWardrobeOutfits` in advisor mode: hard ownership/structure issues reject; many aesthetic or contextual findings annotate; no mechanical reinvention | Local candidate backfill can fill missing count; diagnostic broken cards disclose when no acceptable set is available. See [use-my-wardrobe.md](flows/use-my-wardrobe.md). |
| Saved-outfit Similar / Creative variants | Saved outfit IDs, chosen Main piece, source occasion/season, mode | Adapter calls `generateWholeWardrobeOutfitsVisualInternal`; saved seed and Main piece alter framing and comparison guidance, not gate ownership | Same whole-wardrobe visual composer | Same advisor-mode validation | Same whole-wardrobe fallback; response adds source-outfit debug. See [saved-outfit-variants.md](flows/saved-outfit-variants.md). |
| `/ask` serial search → propose | Persistent thread context plus ephemeral `toolContext`; model chooses search shape | `search_wardrobe` consumes `evaluateAutomaticUsePiecePool`, then applies retrieval ranking, supply-aware broadening, and per-category image budget. It is retrieval, not a finite outfit roster | Model calls `propose_outfit` with explicit role assignments | ID retrieval/sight gates, `validateOutfitRoles`, shared eligibility findings with strict proposal disposition, and output guards; a rejected attempt may remain visible as needs-review | Model may search or propose again within the ten-iteration tool loop; accepted cards govern closing prose. See [freeform-stylist-chat.md](flows/freeform-stylist-chat.md). |
| `/ask` bounded `generate_outfits` | Fresh request classified as bounded or tool-selected bounded generation | Tool resolves shared context; selected-piece requests delegate to `generateOutfitsForPieceInternal`, otherwise to `generateWholeWardrobeOutfitsVisualInternal` | Nested selected or whole composer call; usage is recorded into the parent turn | Delegated flow validation plus accepted-card output guards | Incomplete direct routing falls through to the full stylist; nested flow fallbacks remain active. |
| `/ask` coordinated plan | Model calls `plan_outfit_set` with normalized slots and constraints | `buildPlanSlotWorkbench` resolves each slot and consumes `evaluateAutomaticUsePiecePool`, then applies plan-owned ranking and workbench caps | Model submits via `submit_plan_outfits` | `completeSubmittedPlanOutfits` may fill structural absence; `validateSubmittedPlanOutfits` checks structure, role/dependency, slot, set, repetition, and ownership constraints | Failures are returned to the tool loop for revision; accepted and rejected plan cards are assembled separately. See [freeform-stylist-chat.md](flows/freeform-stylist-chat.md). |
| Atomic seasonal capsule | Same plan entry, `plan_kind: seasonal_capsule` | Capsule slot unions and elevated-demand reserves consume `evaluateAutomaticUsePiecePool`; `selectCapsuleRoster`, `buildCapsuleBench`, optional model selection, postconditions, core capacity and rotation remain capsule strategy | `composeCapsulePlanOnce`, one structured visual composition of the complete rotation | `completeSubmittedPlanOutfits`, then `validateSubmittedPlanOutfits`; utilization and shortfalls are disclosed | Rejected cards are assembled as needs-review; saved versioned plan context enables follow-ons. Capsule behavior authority: [capsule-index-and-plan.md](capsule-index-and-plan.md). |
| Capsule expansion | Saved capsule context, one slot, existing looks | Reload only active saved-roster IDs; intersect slot allowed IDs; stop locally when saved/fallback core capacity is exhausted | One strict structured model call | `validateSubmittedPlanOutfits`; no correction call | Accepted card is appended; invalid attempt or exhaustion is visible. See [capsule-expansion-and-repair.md](flows/capsule-expansion-and-repair.md). |
| Capsule repair | Saved capsule context, rejected IDs, sibling looks | Same active saved slot roster; no wider search | Deterministic missing-category addition or same-category substitution | Every attempt passes `validateSubmittedPlanOutfits` | First accepted repair replaces the card; otherwise a 409 discloses no local fix. Zero provider calls. See [capsule-expansion-and-repair.md](flows/capsule-expansion-and-repair.md). |

Image-only rendering, evaluation, comparison, and intake/tagging flows do not create a new outfit
selection and are therefore outside the pipeline matrix. Their provider calls remain indexed in
[flows/README.md](flows/README.md).

### 3.1 Cross-flow reuse scorecard

The affected-flow counts use the eleven active outfit-producing pipelines above. A flow counts when
it executes the stage itself or delegates to another active pipeline that does. The count ranks
reach; it does not claim every implementation is byte-for-byte duplicate.

| Shared stage | Affected pipelines | Current reusable core | Independently assembled work that remains | Divergence risk | Priority |
|---|---:|---|---|---|---:|
| Context resolution | 10 consumer families; 2 now migrated | `resolveStylingContext` now owns selected-piece and whole-wardrobe context; remaining consumers still use `normalizeOccasion`, `normalizeActivity`, `resolveOccasionProfile`, `resolveActivityProfile`, and `weatherProfileFromContext` directly | Freeform search/propose/swaps/generate and plan slots still independently choose precedence, defaults, live-weather behavior, and mutation | Critical: the same words can still reach later gates with different structured context until the remaining consumers migrate | 1 |
| Piece eligibility | 11 | `evaluateAutomaticUsePiecePool` over `wholeWardrobePieceTrustDecision` and narrow verdict helpers | Visual presentation policy, retrieval broadening, explicit anchor disposition, and post-composition validators still add flow policy | Critical: remaining compatibility and validation callers can still diverge until migrated | 2 |
| Outfit validation | 11 | `isOutfitStructurallyValid` for a narrow category core | Selected gates, whole advisor/gate, freeform roles, plan submission, concept boards, and route-local explanations return different shapes and cover different invariants | Critical: identical outfits can be accepted, annotated, repaired, or rejected for accidental reasons | 3 |
| Candidate-set construction | 10 | Shared rankings and verdicts in places, but no common builder | Selected quotas, visual category ceilings/global cap, search result/image budgets, capsule roster/bench, plan workbench, and local fallbacks each perform selection and truncation | Critical: required categories or dependency supply can disappear before composition | 4 |
| Recovery and fallback | 8 | Some shared validators and footwear helpers | Selected local/absolute fallback, whole backfill, plan completion, capsule repair, freeform retry, and diagnostic cards independently mutate or replace results | High: error paths silently weaken the primary path's contract | 5 |
| Prompt fact projection | 10 | Style Constitution exports and some serializers | Composer, selected-anchor, freeform tool, plan, capsule, board, and saved-variant prompts restate overlapping runtime facts | High: a code fix can be absent from the model-visible contract, or prompt wording can invent another rule | 6 |
| Response normalization | 11 | Several normalization/card assemblers | Source labels, debug reasons, validation failures, needs-review state, plan context, and persistence are assembled per route/tool | Medium: downstream UI and follow-up state see semantically different shapes | 7 |
| Provider invocation and usage | 10 provider-crossing pipelines | `askStylist*` abstraction and telemetry context | Nested-call attribution and direct image/Responses calls remain specialized | Medium but well documented; no broad rewrite justified now | 8 |

Context, eligibility, validation, candidate construction, and recovery are the consolidation core.
Provider unification is intentionally lower priority because it has less effect on domain behavior
and is already substantially shared.

### 3.2 Target reusable pipeline

The target is composition, not inheritance and not one giant stylist function:

```text
raw request + established state
→ resolveStylingContext()
→ evaluatePiecePool(context, eligibilityPolicy)
→ buildCandidateSet(eligible, rankingStrategy, coverageRequirements, capacity)
→ compose(flowComposer, context, candidateSet)
→ validateOutfits(outfits, context, validationPolicy)
→ applyDisposition(findings, dispositionPolicy)
→ recoverIfNeeded(sharedRecoveryPrimitives, recoveryPolicy)
→ normalizeOutfitResponse()
```

The names are illustrative; the contracts matter. A flow policy may choose an anchor ranking,
capsule recombination, advisor annotation, or zero-retry behavior. It may not supply a second
implementation of context precedence, eligibility, structure, or post-mutation validation.

| Stage | Shared runtime result | Flow-controlled inputs | Forbidden flow-local replacement |
|---|---|---|---|
| Context | Normalized occasion/activity/season/weather, request constraints, anchors, exclusions, provenance | Required fields, live-weather permission, explicit current-request overrides | Re-parsing and precedence logic inside individual tools/routes |
| Eligibility | Per-piece `{ allowed, findings, evidence }` | Anchor override, photo requirement, disclosed supply relaxation | Parallel weather/register/activity/owner gates |
| Candidate set | Selected pieces plus coverage report, excluded reasons, cap utilization | Ranking callback, capacity, required structures, diversity objective | Independent quota/truncation code that can starve structure |
| Validation | One list of typed findings for ownership, core structure, dependency, context, and set rules | Which optional validator extensions run | Separate booleans and prose diagnoses of the same invariant |
| Disposition | Accepted, annotated, repairable, or rejected results | Advisor/gate mode, retry budget, visibility policy | Changing the underlying finding to obtain a preferred disposition |
| Recovery | Mutated candidate plus validation result, or explicit shortfall | Allowed mutations and cost boundary | Returning an unvalidated fallback or widening a hard exclusion |
| Response | Stable outfit/card/debug shape with provenance | Flow-specific labels and UI actions | Route-specific semantic variants of accepted/rejected state |

### 3.3 What “done” means for reuse

A consolidation slice is not complete because functions share vocabulary or tests show equivalent
outputs. It is complete only when:

1. the shared stage has an executable contract and direct tests;
2. every named active consumer calls or receives that implementation;
3. flow variation is expressed as data/callback policy with a bounded interface;
4. old branches that answered the same question are deleted in the same slice;
5. primary and fallback paths pass through the same hard-result contract;
6. an architecture ratchet prevents a retired implementation from reappearing;
7. behavior fixtures cover multiple unrelated domains, not only the triggering bug.

---

## 4. Responsibility census

### 4.1 Piece truth and projections

**Semantic contract:** Stored fields and normalized readers own piece facts. Text inference is a
missing-data fallback inside `attributes.js` only. Serializers may transmit facts but may not
reinterpret them.

| Decision surface | Current decision | Classification | Active consumers |
|---|---|---|---|
| Piece schema, form lifecycle, tagger outputs, [garment-field-reference.md](garment-field-reference.md) | Field meaning, accepted vocabulary, persistence | `canonical` for stored facts | Forms, DB, taggers, all readers |
| `parsePiece` in `rules.js` | Normalize DB representation and parsed JSON fields | `adapter` | Routes, rules, tools, planners |
| Attribute readers in `attributes.js` | Interpret structured values and approved text fallback | `canonical` | Rules, planner, tools, prompts/projections |
| `attributePieceTextBlob` in `attributes.js` | Text source used by attribute fallbacks | `canonical` for attribute text fallback | Attribute readers |
| `pieceTextBlob` in `rules.js` | A second normalized piece text blob used by rules | `duplicate` unless its narrower/wider input set is proven to be projection-only | Rule predicates and scoring helpers |
| `buildPieceText`, `composerPieceLineSuffix`, wardrobe manifests, tool rows | Present piece facts to models and logs | `projection` | Composer prompts, `/ask` tools, diagnostics |
| Prompt-specific piece lines in `routes/ai.js` and `outfitSetPlanner.js` | Flow-sized serialization and image labels | `projection` | Selected, whole, boards, capsule |

**Shared invariants**

- Structured fields win over text; missing data is not silently converted into a confident fact.
- Any text interpretation belongs in `attributes.js`, uses bounded matching, and carries the
  required backfill marker.
- A projection can omit facts for budget but cannot assign a different meaning to the facts it
  includes.

**Proposed owner:** Keep the ownership chain `field reference/schema → attributes reader → domain
verdict → projection`. Migrate rule predicates away from `rules.js`'s private text blob or prove
that the function is only a serializer and rename it accordingly.

**Owner ruling required:** Is any input difference between `attributePieceTextBlob` and
`pieceTextBlob` intentional and relied upon? Until fixture comparison answers that, deletion is not
authorized.

### 4.2 Eligibility and hard gates

**Semantic contract:** Given a piece and resolved context, return whether automatic use is
allowed, plus structured reasons and evidence confidence. Flow strategy may add stricter roster
requirements but may not redefine the underlying verdict.

| Decision surface | Current decision | Classification | Active consumers |
|---|---|---|---|
| `wholeWardrobePieceTrustDecision` | Aggregate owner constraint, occasion/register, weather, activity, footwear, and auto-styling trust for one piece | `canonical` aggregate for automatic-use eligibility | Selected ranking, whole filtering/scoring, freeform search/propose/swaps/generate, plan workbench, repairs |
| `profileRuleFit`, `footwearComfortVerdict`, `registerCeilingVerdict`, weather and occasion readers | Narrow contextual verdicts | `canonical` primitives | Trust aggregate, visual roster, scores, plan validation, search |
| `filterWholeWardrobePiecesForGeneration` | Legacy adapter applying the trust aggregate across a pool plus hot-outerwear supply behavior | `legacy` compatibility adapter | Remaining recovery caller in `rules.js` |
| Selected-piece anchor bypass | Keep the user-selected premise even when ordinary auto-use gates would exclude it | `specialization` | Selected visual/text composers and boards |
| `buildVisualComposerRoster` | Photo availability, metadata completeness, supply-aware register/activity policy, visual relevance, category ceilings and global image cap | `specialization`; `adapter` where it calls shared verdicts; `unresolved` for parallel gate branches | Selected visual and whole visual composers |
| `search_wardrobe` filtering and broadening | Active/category/owner exclusions are fixed; descriptive and occasion filters may relax with disclosure | `specialization` | Freeform serial retrieval |
| Capsule slot filtering in `buildPlanSlotWorkbench` and capsule selectors | Shared automatic-use findings plus slot weather/activity/register; finite budget, capsule supply, and postconditions remain plan strategy | `adapter` to shared eligibility plus `specialization` | Coordinated plans and capsules |
| `validateOutfitRoles` / `validateSubmittedPlanOutfits` per-piece checks | Reject a composition after selection | `adapter` to shared eligibility where delegated; otherwise covered under validation below | Freeform cards and plan submissions |

**Intentional differences**

- A selected anchor is explicit user input, not an automatically recommended candidate.
- A visual roster may require a usable photo and fit within a hard provider image budget.
- Search broadening preserves hard exclusions but may relax soft discovery filters and tells the
  model what changed.
- Supply-aware roster policy can distinguish “unknown/inappropriate but alternatives exist” from
  “only available supply,” provided the relaxation is disclosed.

**Proposed owner:** `wholeWardrobePieceTrustDecision` remains the aggregate answer to “may the app
automatically use this piece in this context?” Its narrow inputs remain owned by their fact and
verdict helpers. Visual-photo eligibility, finite roster capacity, and explicit anchor override stay
outside it as named policy layers.

**Owner rulings required:** Review each parallel branch inside `buildVisualComposerRoster` against
the aggregate. The hot-weather tests explicitly preserve some policy differences; they must not be
collapsed merely because the predicates look similar. Decide whether unknown metadata is a hard
visual-roster exclusion or a supply-aware disclosed relaxation per field.

### 4.3 Candidate ranking

**Semantic contract:** Rank already-eligible candidates for a named objective and emit observable
reasons. Ranking must not hide validity as a large penalty.

| Strategy owner | Objective | Classification | Consumers |
|---|---|---|---|
| `compatibilityScoreForSelectedItem` / `rankedComplementaryWardrobeFor` | Support one anchor while preserving category supply | `canonical` selected-anchor strategy | Selected composer and boards |
| `selectCandidatesForOutfitGeneration` | Full-pool selected ranking followed by category quotas and limit | `specialization` / roster adapter | Selected composer and boards |
| `scoreWholeWardrobeCandidate` and local candidate construction | Contextual whole-outfit score and diversity | `canonical` whole-wardrobe strategy | Whole advisor fallback and ranking diagnostics |
| Relevance scoring in `buildVisualComposerRoster` | Prioritize finite photographs after hard/supply policy | `specialization` | Visual composers |
| `capsuleVersatilityScore`, capsule selectors, representative rotation | Recombination and finite-budget utility | `canonical` capsule strategy | Atomic capsule |
| `selectPlanWorkbenchPieces` | Slot relevance within workbench cap | `specialization` | Coordinated plans/capsule slots |
| `search_wardrobe` ordering | Query match, profile/weather/activity fit, and per-category visual supply | `specialization` | Freeform retrieval |
| Slot-swap ranking | Preserve an accepted outfit while replacing one role | `specialization` | Freeform `suggest_slot_swaps` |

**Proposed owner:** Do not create a universal score. Share fact readers and hard verdicts; keep one
named strategy per objective with reason strings. The roster-coverage contract in §4.4 operates
after ranking and before hard truncation.

**Migration constraint:** Any ranking or attribute-reader change requires the repository ranking
A/B diff and an explanation for every changed ordering. A pure orchestration move must produce a
zero diff.

### 4.4 Roster and retrieval construction

**Semantic contract proposed for consolidation:**

```text
eligible candidates
+ required outfit structures
+ protected anchors
+ dependency requirements
+ hard capacity
→ covered selection | explicit coverage shortfall
```

| Decision surface | Current coverage behavior | Classification |
|---|---|---|
| `selectCandidatesForOutfitGeneration` | Per-category quotas after full eligible ranking | `specialization`; partial structural protection |
| `buildVisualComposerRoster` | Category ceilings, then global trim; photo/metadata/provider cap | `specialization`; `unresolved` for complete-structure preservation |
| `search_wardrobe` | Per-category result and image budgets; no claim to form a finite outfit roster | `specialization`, not a roster contract consumer unless a caller asks for complete outfit supply |
| `selectCapsuleRoster` | Quotas, reserves, postconditions, explicit supply gaps | `canonical` capsule roster strategy |
| `buildCapsuleBench` | Seeds deterministic roster and protects categories/slots for model selection | `specialization` |
| `selectCapsuleRosterViaModel` | Bounded model selection with allowlist validation and deterministic fallback | `specialization` |
| `buildPlanSlotWorkbench` / `selectPlanWorkbenchPieces` | Slot-specific gate-passing set with a hard workbench limit | `specialization`; `unresolved` for structure preservation at the cap |
| Selected and whole local fallback selectors | Directly choose leading candidates | `legacy` with respect to future shared coverage; active until parity fixtures exist |

**Shared invariants**

- Ranking and global truncation may not silently remove the last eligible member of a required
  structure when capacity can preserve it.
- Protected anchors survive.
- Dependency requirements participate in capacity, rather than being discovered only after model
  composition.
- Impossible capacity returns a named shortfall; it does not overflow the provider limit or weaken
  a hard gate.

**Proposed owner:** A small dependency-neutral structural-coverage verdict, separate from the
selected, visual, search, and capsule selectors. Do not place the generic contract inside
`outfitSetPlanner.js`, which would give capsule/plan orchestration false ownership. The exact module
location is unresolved until the shared eligibility, validation, and required-structure result
shapes are approved; its first consumers should be selected candidates, visual roster final trim,
plan workbench caps, capsule postconditions, and deterministic fallbacks.

**Owner rulings required:** Which structures must each non-capsule flow guarantee before model
composition? Is the visual roster's global cap allowed to disclose a shortfall and proceed, or must
it stop? Search remains retrieval unless `generate_outfits` asks it to satisfy a complete roster
contract.

### 4.5 Layering and base-layer semantics

There is currently no single owner. The shared concept must be split into six questions.

| Contract | Current surfaces | Current missing-data behavior | Classification / proposed owner |
|---|---|---|---|
| Dependent status: does this piece need something beneath it? | Structured `needs_base`; capsule-local `pieceNeedsBase`; prompt lines | Missing generally means independent | `canonical` reader should live in `attributes.js`; capsule wrapper becomes adapter |
| Independent coverage: can this top provide usable torso coverage by itself? | `pieceReadsAsStandaloneBaseTop`; capsule-local `isCapsuleBaseCandidate` | Freeform reader may use normalized text fallback; capsule treats unknown opacity as eligible if `needs_base` is false | `unresolved`; one tri-state verdict with explicit evidence and flow policy for `unknown` |
| Pair mechanics: can base A physically sit beneath dependent piece B? | Visual composer prompt requires close `fit_on_body`; no shared code verdict | Missing fit evidence is left to model judgment | New canonical tri-state verdict consuming structured fit/weight/coverage facts |
| Layer direction: which piece may sit over/under which? | `pieceHasExplicitTopLayerEvidence`, `pieceHasExplicitBaseLayerEvidence`, `pieceDressSupportsUnderlayer`; plan/freeform checks | Explicit evidence required for unusual direction | Existing attribute readers stay canonical; add a shared direction verdict rather than prompt-only restatement |
| Sight requirement: must photos be inspected? | Tool sight gates, visual roster, composer prompt | Varies by path and image availability | Shared verdict should name `none`, `one`, or `both`; flow controls whether unavailable sight rejects or discloses uncertainty |
| Visual success: do neckline, bulk, texture, color, and proportion work? | Visual composer and stylist model | Not deterministically inferable | Model-owned judgment; never converted into keyword taste rules |

**Known parity gaps**

- `buildLocalFallbackOutfitDirections` only pushes `needs_base` pieces later; it does not prove a
  viable base pairing.
- The selected absolute backfill and `repairWholeWardrobeOutfit` have no general dependent-piece
  completion contract.
- Capsule capacity and base postconditions use a different independent-coverage assumption than
  freeform role validation.

**Proposed result shape:** `{ verdict: 'compatible' | 'incompatible' | 'unknown', reasons,
evidence, sightRequired }`. Dependent status and independent coverage can expose narrower verdicts,
while pair mechanics consumes both pieces. Flow policy decides what to do with `unknown`; the
fact owner does not silently turn it into allow or reject.

**Owner rulings required:** For unknown opacity and fit, which flows may proceed to visual judgment,
which must require sight, and which finite rosters must reserve a safer base? Does a user-selected
dependent anchor bypass automatic eligibility only if the roster can still supply coverage?

### 4.6 Composition constraints and prompt projections

| Surface | Owns | Classification |
|---|---|---|
| Style Constitution exports in `prompts.js` | Ratified taste/style guidance | `canonical` |
| `WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM` | Whole visual composition strategy and output contract | `specialization`; `projection` for domain facts |
| Selected-anchor prompt additions in `routes/ai.js` | Anchor premise, selected flow behavior | `specialization` |
| `OUTFIT_COMPOSER_SYSTEM` and evaluator prompts | Selected text/ideal strategy | `specialization` |
| Freeform tool schemas and controller prompt | Conversation protocol, roles, retrieval/sight requirements | Existing owner map in [freeform-prompt-ownership.md](freeform-prompt-ownership.md) |
| Capsule roster/composition prompts and slot submission requirements | Finite capsule strategy and plan output schema | `specialization`; `projection` for hard validator facts |
| Saved-variant request framing | Preserve formula/Main piece or explore adjacent style neighborhood | `specialization` |
| Local candidate generators | Deterministic reduced-ambition composition | `legacy` where they restate hard constraints incompletely |

**Proposed owner:** Domain invariants originate in code/data verdicts and have one serializer that
projects the result into each prompt that needs it. Flow prompts continue to own strategy and output
shape. Do not merge prompts or disturb cache boundaries merely to share wording.

**Ratchet needed after implementation:** For every canonical invariant, fixtures prove each required
prompt projection still contains its serialized contract and each mechanical validator consumes the
same verdict. Prompt presence alone is not enforcement.

### 4.7 Outfit validation

| Decision surface | Verdict | Classification | Disposition |
|---|---|---|---|
| `isOutfitStructurallyValid` | Category-level core: top+bottom or dress, shoe count, conflicting categories | `canonical` narrow structural boolean | Used by selected/whole/plan paths |
| `describeOutfitStructureGap` | Human-readable explanation of nearly the same category structure | `duplicate` semantic computation, useful projection | Capsule repair diagnosis and plan failures |
| `locallyGateOutfitDirections` | Anchor present, minimum piece count, no duplicate IDs | `specialization`, not a full validator | Reject selected text directions |
| `sanitizeSelectedPieceOutfitDirections` | Selected layer coherence and cleanup | `specialization` | Remove or normalize selected results |
| `locallyGateWholeWardrobeOutfits` | Structure, ownership, context/profile findings, diversity; gate/advisor modes | `adapter` plus disposition specialization | Gate rejects; advisor annotates many concerns and does not reinvent |
| `validateOutfitRoles` | Freeform explicit role cardinality, shoes, missing gaps, base independence | `specialization`; `unresolved` where base logic differs | Reject proposed card with issues |
| `validateCapsuleRoster` | Finite roster quotas, base/structure supply, slots and budget | `specialization` | Reject or report roster gaps |
| `validateSlotOutfitConstraints` | Slot weather/activity/register/season and plan requirements | `specialization` | Failure reason for plan submission |
| `validateSubmittedPlanOutfits` | Ownership, structure, dependency, slot, repetition, core uniqueness, set rules | `canonical` plan validator / orchestration | Accept or return structured failures |
| Route-local board filters | Allowed IDs, anchor, dedupe, minimum piece count | `specialization`; incomplete by design for concept boards | Skip unusable boards |

**Proposed owner:** Evolve the narrow structural owner to return a structured verdict with reason
codes; keep `isOutfitStructurallyValid` as a thin boolean adapter and make
`describeOutfitStructureGap` a projection of the same verdict. Role, slot, and set validators remain
specializations that compose shared structure, eligibility, and layer/base verdicts.

**Owner rulings required:** Confirm that concept boards are permitted to remain a looser
visualization surface, and enumerate which advisor findings remain annotation rather than rejection.
The ratified whole-wardrobe no-reinvention rule stays intact.

### 4.8 Repair, completion, retry, and fallback

| Surface | What it actually changes | Classification |
|---|---|---|
| `applyComfortFootwearRepair` | Selected-flow footwear substitution under an active comfort constraint | `specialization` consuming shared footwear verdicts |
| `repairWholeWardrobeOutfit` | Normalizes/protects prose and can substitute required footwear; not a general structural repair | `specialization`; name overstates scope |
| `completeSubmittedPlanOutfits` | Adds a missing structural category from the slot's allowed roster, revalidating the set | `canonical` plan completion strategy |
| `/repair-capsule-look` | Deterministic missing-piece addition or one-for-one same-category swap, validating every attempt | `specialization` |
| `/expand-capsule` | No repair; one composition and one validation pass | `specialization` / explicit no-retry disposition |
| Freeform tool-loop correction | Model can act on validation failures in a later iteration | `specialization` / paid retry boundary |
| Selected local fallback and absolute backfill | Reduced-ambition deterministic directions | `legacy` relative to shared hard-parity requirement; active |
| Whole local candidate backfill | Ranked local candidates passed through whole gating | `specialization` with stronger shared parity |
| Whole diagnostic cards | Surface why acceptable cards could not be produced | `canonical` disclosure disposition for advisor failure |

**Shared invariant proposed:** Primary, repair, completion, and fallback paths consume the same hard
ownership, eligibility, structure, and dependency verdicts. They may differ in ambition, aesthetic
judgment, retry cost, and whether a soft finding annotates or rejects.

**Proposed owner:** Keep repair strategies local to the flow; share the verdicts they test. Add a
common “validate candidate after mutation” adapter so a repair cannot return an unvalidated card.
Rename functions only in the migration slice where callers and docs change together.

**Owner rulings required:** Should the selected absolute fallback be allowed to return a needs-review
card when no fully valid composition exists, or should it disclose an empty/gap result? Should local
fallback ever proceed with an unknown base pairing if photos are unavailable?

### 4.9 Provider execution and telemetry

The [flow atlas](flows/README.md) is the provider-call authority. The two former gaps are now mapped
in [capsule-expansion-and-repair.md](flows/capsule-expansion-and-repair.md).

| Execution family | Active owner | Notes |
|---|---|---|
| Standard text calls | `askStylist` in `provider.js` | Used by route and core composition/evaluation flows. |
| Strict structured calls | `askStylistStructuredWithUsage` in `provider.js` | Used by bounded routing/composition, capsule composition/expansion, and feedback synthesis. |
| Tool loop | `askStylistWithTools` in `provider.js` | `/ask` only; up to ten iterations. |
| Nested bounded composers | `generate_outfits`, atomic capsule composition | Usage is explicitly recorded into parent `toolContext`. |
| Direct OpenAI Responses and image calls | `core.js` rendering/editorial helpers | Separate image/vision execution paths documented by their flow pages. |
| Importer/tagger and feedback calls | `routes/ai.js`, `routes/feedback.js`, importer routes | Non-outfit selection, but active and retained in atlas census. |

**Proposed owner:** No provider consolidation in this pass. Preserve the provider abstraction where
already used, and require every nested call to attribute usage to its parent user turn. Direct image
calls remain separate until a correctness or telemetry defect justifies migration.

**Finding:** `capsuleExpansionCoreCapacity` is parallel to the fuller capsule capacity owner. It is
classified `duplicate/unresolved`: the route prefers saved canonical capacity, but legacy/fallback
state can activate the simpler local calculation.

### 4.10 Conversation state authority per field

Persistent state is stored by `getStylistConversationState` and
`saveStylistConversationState`. `buildStylistConversationPayload` resolves the server payload;
`toolContext` is the mutable one-turn working state; response cards and browser history are UI
handoffs, not interchangeable stores.

| Field | Writer and lifetime | Precedence / authority | Active consumers |
|---|---|---|---|
| Occasion | Request body, tool declarations/plans; persisted when established | Explicit current body wins; persistent server value restores only on a non-new request | Router context, prompts, search, composers, validators |
| Activity | Same as occasion | Explicit current body wins; then established server state | Weather/activity gates, footwear, plan slots, prompts |
| Season | Request body and resolved conversation context; persistent | Explicit current body wins; persistent fallback on continuation | Weather resolution, eligibility, prompts, roster |
| Weather profile | Resolved from explicit/current context and saved as normalized state | Current resolved weather wins; stored profile is continuation fallback, not a new forecast | Visual composer, trust/roster gates, plans |
| Current outfit set | Successful bounded/tool composition; persistent normalized summary plus response cards | Server state is follow-up context; actual response cards are the display/product authority for the current turn | Follow-up resolution, accepted-card guards, UI |
| Active outfit / selected subjects | Request body and thread/body context | Explicit current card/piece reference wins; recovered state assists ambiguous follow-up | Compact profiles, full prompt, tool context |
| Pending plan | `plan_outfit_set` inside one tool loop | Ephemeral and authoritative only for the matching `submit_plan_outfits`; not a general persistent plan store | Plan submission, atomic capsule composer |
| Retrieved piece IDs | Search/workbench/nested composer inside `toolContext` | Ephemeral evidence gate; cannot be reconstructed from prose | `propose_outfit`, sight/ownership guards, diagnostics |
| Visually seen piece IDs | `view_pieces`, visual roster/composer, capsule thumbnails | Ephemeral evidence authority for sight-required claims | Role/plan validation, proposal guards, diagnostics |
| Capsule reusable plan context | Response card payload assembled after accepted atomic plan | Versioned card state; follow-on routes validate it and reload DB rows rather than trusting embedded piece objects | Capsule expansion and repair |
| Browser history/context echoes | `StylistChat.jsx`, per request | Fallback/conversation evidence; does not override explicit normalized server fields | Payload building and model messages |

**Proposed owner:** Keep server persistent state authoritative for established conversational fields,
`toolContext` authoritative for one-turn evidence and pending work, and cards authoritative for what
was actually delivered. Document new fields in this per-field form; do not create a second generic
state object.

**Owner rulings required:** Define expiry/recovery behavior for stale weather and pending plan state.
Confirm whether capsule card context remains the only durable plan artifact or should eventually be
server-persisted. These are separate state-design decisions and do not block the first architecture
slice.

---

## 5. Proposed ownership decisions

| Contract | Proposed canonical owner | Allowed specialization | Surfaces to migrate/delete after approval |
|---|---|---|---|
| Piece text fallback | `attributes.js` readers and `attributePieceTextBlob` | Prompt/tool serializers may choose fields and formatting | Compare then remove/rename `rules.js` `pieceTextBlob`; migrate any semantic callers |
| Automatic-use eligibility | `wholeWardrobePieceTrustDecision` composed from narrow verdict owners | Anchor override, visual-photo policy, supply-aware disclosed relaxation, finite provider caps | Parallel gate branches in visual roster and plan/freeform validators that restate the same verdict |
| Normalized styling context | New shared builder composed from the existing normalizers, profile resolvers, weather resolver, and explicit provenance | Flow declares required fields and whether live lookup is permitted | Route/tool-local precedence and default assembly after consumers migrate |
| Layer/base facts and pair mechanics | Tri-state verdict family built on `attributes.js`, consumed inside shared eligibility/validation | Flow policy for `unknown`; model visual judgment; sight availability disposition | Capsule-local base predicates, freeform standalone wrapper, prompt-only fit rule, fallback heuristics |
| Outfit core structure | Structured verdict returned by the current `isOutfitStructurallyValid` semantic owner | Role, slot, set, advisor/gate disposition | `describeOutfitStructureGap` mirrored logic; route-local restatements where equivalent |
| Bounded structural roster coverage | New dependency-neutral verdict/selection contract built on the shared eligibility and validation interfaces | Selected relevance, visual photo budget, capsule recombination, plan slot limits | Category-only protection and silent final trims where complete structure is required |
| Ranking | One existing strategy per objective, consuming shared facts/verdicts | Objective-specific weights, diversity, recency, anchor relevance | Hidden gate-like penalties only; do not merge strategies |
| Candidate-set construction | Shared builder combining an injected ranking strategy, structural coverage, protected IDs, and hard capacity | Anchor relevance, whole breadth, capsule recombination, search retrieval mode | Flow-local quota/cap implementations once their policy is representable |
| Repair/fallback validity | Shared post-mutation validation adapter and recovery primitives over canonical verdicts | Flow-local allowed mutations and cost/disclosure policy | Unvalidated selected fallback/backfill behavior and duplicated mutation loops |
| Response normalization | Stable accepted/rejected outfit result with provenance and findings | Flow labels, actions, and display copy | Route/tool-specific semantic result shapes |
| Prompt invariant projection | Canonical verdict serializer adjacent to verdict owner | Flow prompt strategy and output schema | Independently worded domain definitions after all consumers migrate |
| Provider execution | Existing `provider.js` abstraction and flow atlas | Direct image execution when documented | Only untraced calls or telemetry bypasses; no broad provider rewrite |
| Conversation state | Per-field authority: persistent server, ephemeral evidence, delivered card | Explicit current-request override and versioned card capability | Conflicting field writers only after a separate state slice |

---

## 6. Recommended migration sequence after owner review

### Module-design gate

Every slice must pass the deep-module gate in
[architecture-ownership-consolidation-spec.md](architecture-ownership-consolidation-spec.md)
before implementation. In this sequence, a “shared stage” means one deep runtime module with a
small domain interface, not a common directory, pass-through helper, or generic pipeline whose
callers still assemble the decisions.

The deletion test applies per slice: complexity must move behind the surviving interface and the
old decision surfaces must be removed as their callers migrate. Slice 7 verifies those deletions
and catches recurrence; it is not a deferred cleanup phase.

### Slice 0 — freeze cross-flow behavior

Create a shared fixture corpus that runs the same wardrobe/request pairs through selected, whole,
freeform bounded, freeform serial, coordinated-plan, and capsule entry points. Record context,
eligible IDs, bounded candidate IDs, validation findings, recovery actions, and final disposition.
Include layering, but also occasion ceilings, hiking footwear, hot weather, owner exclusions,
category starvation, unknown metadata, and ordinary neutral cases.

This is the baseline that distinguishes consolidation from accidental product redesign.

### Slice 1 — normalized styling context

Build one executable context resolver from the existing normalizers and profile/weather owners.
It returns values plus provenance such as `explicit_request`, `established_state`, `slot`, `live`, or
`fallback`. Migrate direct selected/whole routes first, then freeform tools, then plan slots. Delete
the replaced precedence/default branches as each consumer moves.

**Why first:** every later shared stage is unreliable if callers send materially different context
for equivalent requests.

**Deep-module design:** place the seam at one call that accepts named evidence sources rather than
an already-ordered list. The caller supplies raw explicit request evidence, saved-artifact evidence,
established server state, and permitted inference inputs. The implementation owns normalization,
precedence, conflict recording, profile construction, weather-source selection, and provenance.
Callers receive one resolved result:

```text
resolveStylingContext(evidence, resolutionPolicy)
→ {
    occasion, activity, season, weatherProfile,
    requestConstraints, anchors, exclusions,
    provenanceByField, conflicts
  }
```

`resolutionPolicy` may select a ratified product mode such as `direct_request`, `saved_artifact`, or
`plan_slot`; it may not supply custom precedence callbacks or redo normalization. Live-weather and
clock substitution belong at internal seams used by the implementation and its deterministic
tests, not in every production call. The existing normalizers and weather/profile readers remain
implementation dependencies; wrapping them without absorbing source precedence would fail the
deletion test.

**First migration boundary:** direct selected-piece and whole-wardrobe generation are the first two
adapters because they already consume the same occasion, activity, season, request, and weather
facts while assembling profiles separately. Contract tests run both through identical evidence and
assert the same values and provenance. Consumer tests then prove each route delegates through the
shared interface before its replaced assembly branches are deleted.

**First-consumer result, implemented 2026-08-24:**

| Context concern | Shared behavior in selected-piece and whole-wardrobe composition |
|---|---|---|
| Request input | Each generator passes named evidence to `resolveStylingContext`; the resolver, not the caller, owns source order and normalization |
| Occasion/activity profiles | `resolveStylingContext` constructs both profiles once; visual composers receive the resolved profiles instead of rebuilding them |
| Activity hardness | Declared activity remains separate from request-inferred activity, so soft walking inference does not silently activate hard footwear gates |
| Weather | Explicit stated weather wins; current-season requests refresh from live weather when location is available; a saved snapshot is the fallback when live lookup is unavailable; authored hypothetical seasons use the deterministic heuristic |
| Provenance/conflicts | Both response debug payloads expose `stylingContext`, including resolved values, per-field source, ignored conflicting evidence, and weather authority |

This is not harmless duplication: identical current-season evidence can reach different physical
weather facts before eligibility. Per [CONTEXT.md](CONTEXT.md), **Normalize** means vocabulary/schema
coercion while **Resolve** means choosing a structured value from raw or ambiguous input. Slice 1
must own both steps explicitly rather than calling a collection of normalizers a context resolver.

**Owner ruling, 2026-08-24:** precedence is field-specific. Occasion, activity, and mission use
explicit request > saved/action artifact > established state > inference. Stated weather uses the
current explicit statement before a saved slot statement. Physical weather uses live forecast for
the authoritative date/location > saved snapshot > heuristic. Date and location use explicit >
saved artifact > established state > default. An explicit hypothetical season does not fetch live
weather; a saved current-season snapshot refreshes live when possible. The resolver encodes this
order and reports conflicts instead of asking each caller to recreate it.

### Slice 2 — executable eligibility pipeline

Wrap the existing narrow verdicts and `wholeWardrobePieceTrustDecision` in one pool evaluator.
Express selected-anchor bypass, photo requirements, and supply-aware relaxation as explicit policy
inputs with observable output. Migrate selected ranking, whole visual roster, freeform search and
proposal, plan workbench, capsule roster, and recovery candidate pools. Delete equivalent local
gates after each migration.

**Required proof:** the same piece/context produces the same underlying findings in every flow even
when disposition differs.

**First-consumer migration, 2026-08-24:** `evaluateVisualComposerPiecePool` now owns the finite
photo-pool decision for selected-piece and whole-wardrobe visual composition. It returns typed
`validity`, `presentation`, and `capacity` findings plus two deliberate projections: the model photo
roster and the recovery-safe pool. Selected local fallback, absolute fallback, and comfort repair
may reuse pieces omitted only for presentation/capacity, but cannot reintroduce a weather,
register, activity, footwear, metadata, or other validity exclusion. A full-wardrobe recovery pass
through the same authority preserves shoe-anchor substitution without reopening an unfiltered pool.

The same slice removes legacy `do_not_pair_rules` prose from visual-review routing. Those notes were
generated by several tagger versions without stable provenance; their presence is advisory evidence,
not an executable finding. Whole-wardrobe clash review now requires a concrete multi-pattern signal.
At that point, selected ranking, freeform, plan, capsule, and trust/suppression consumers still
needed migration before Slice 2 could be complete.

**Second-consumer migration, 2026-08-24:** `evaluateAutomaticUsePiecePool` now projects the hard
gate into per-piece typed findings, underlying disposition, effective disposition, and explicit
owner authority. Freeform `search_wardrobe`, `propose_outfit`, and `suggest_slot_swaps` consume that
one result. Search keeps its approved retrieval policy—only owner vetoes are fixed at the early
stage, while profile findings remain explainable—whereas proposal and swap replacement remain
strict. Anchor bypass changes effective disposition without deleting underlying findings. The
remaining selected ranking, whole filter compatibility adapter, plan, capsule, and recovery
consumers still need migration before Slice 2 is complete.

**Third-consumer migration, 2026-08-24:** selected-piece generation and concept-board planning now
use `selectAutomaticUseCandidatesForOutfitGeneration`, which injects one shared decision map into
the existing score/category-quota strategy. Whole-wardrobe generation consumes
`evaluateAutomaticUsePiecePool` directly; hot-weather outerwear trimming is an explicit capacity
policy and saved-Main bypass changes only effective disposition. Direct parity fixtures preserve
selected ordering/reasons, and the cross-flow baseline proves the pool matches the old whole filter.
Plan, capsule, and remaining recovery callers still use the compatibility filter and are the next
Slice 2 consumers.

**Fourth-consumer migration, 2026-08-24:** coordinated-plan workbenches, capsule slot unions, and
elevated capsule supply checks now call `evaluateAutomaticUsePiecePool` through
`evaluatePlannerAutomaticUsePool`. The adapter preserves each resolved slot's weather, activity,
register override, and owner-exclusion occasion, while making the three-piece hot-weather
outerwear limit an explicit capacity policy. Plan ranking, workbench caps, capsule quotas, roster
selection, and recombination remain strategy owned by `outfitSetPlanner.js`; suppressed diagnostics
read `underlyingExcludedPieces` so typed findings are not lost. The only production caller of the
legacy whole-filter adapter now sits in recovery logic in `rules.js`.

### Slice 3 — structured outfit validation

Replace parallel booleans and prose diagnoses with one typed finding pipeline. Compose core
structure, ownership, eligibility, dependency, and optional slot/set validators. Preserve selected,
advisor, freeform, and capsule behavior by mapping the shared findings through distinct disposition
policies. Make `isOutfitStructurallyValid` a compatibility adapter temporarily, then remove it when
all callers consume the structured result.

**Required proof:** identical outfits produce identical findings across flows; only the reviewed
disposition may differ.

### Slice 4 — reusable candidate-set construction

Build one bounded-set implementation that accepts eligible pieces, an injected ranking strategy,
protected IDs, required structures, dependency requirements, and hard capacity. It returns selected
pieces plus an explicit coverage/cap report. Migrate selected quotas, visual global trim, plan
workbench limits, and capsule postconditions. Keep search in retrieval mode while reusing the same
eligibility and cap primitives.

**Required proof:** no hard cap silently removes the last viable structure when capacity permits;
impossible coverage is surfaced consistently.

### Slice 5 — shared recovery primitives

Implement validated `substitute`, `complete`, `fallback`, and `discloseShortfall` operations. Every
mutation immediately runs the shared validator. Migrate selected local/absolute fallback, whole
backfill/footwear repair, plan completion, capsule repair, and freeform correction paths. Cost and
retry budgets remain flow policy.

**Required proof:** no recovery path can return a result the corresponding primary validator would
reject on a hard invariant.

### Slice 6 — projections and response normalization

Generate model-visible invariant text from shared context/eligibility/validation results. Normalize
accepted, annotated, repairable, and rejected response shapes with provenance. Keep prompts,
composer strategies, cache boundaries, and UI-specific actions distinct.

### Slice 7 — final architecture ratchets

Confirm that retired gate, quota, diagnosis, fallback, and context branches were deleted in their
owning slices. Add narrow checks that active entry points import/inject the shared stages and that
retired symbols cannot return. Re-run the full cross-flow fixture corpus and ranking A/B diff. Only
after this should provider/state cleanup be considered.

Each slice is one semantic contract, updates the matching behavioral docs in the same commit, runs
the full offline suite, and runs the ranking A/B diff whenever scoring or attribute classification
can change.

---

## 7. Owner decisions needed before production changes

1. **Context:** When explicit request, established server state, saved card state, and inferred slot
   context disagree, is the proposed precedence order correct: explicit request → saved artifact
   being acted on → established server state → inference/fallback?
2. **Eligibility policy:** Which differences are approved policy inputs rather than separate gates:
   selected-anchor bypass, missing-photo exclusion, metadata completeness, and supply-aware
   relaxation?
3. **Unknown evidence:** Across all piece facts—not only layering—when may a flow proceed to model
   judgment, when must it require sight, and when must it disclose or reject?
4. **Candidate guarantees:** Which flows require a complete pre-composition structure, and which
   retrieval flows may return partial supply with a named gap?
5. **Validation disposition:** Confirm which typed findings are universally hard, and which may be
   annotated in whole-wardrobe advisor mode while rejecting in a stricter flow.
6. **Recovery contract:** When no fully valid recovery exists, should each product return nothing,
   a visible gap, or an explicitly needs-review card? No flow should silently weaken a hard finding.
7. **Lighter products:** Are concept boards intentionally allowed their current lighter validation,
   or should they consume the shared validator with a reduced policy?
8. **State boundaries:** Confirm that capsule saved-card context and freeform persistent context are
   distinct policy inputs to the shared context resolver; server-side capsule persistence remains a
   separate future decision.

Until these are answered, the relevant rows remain `unresolved` and no consolidation slice should
change production code.

---

## 8. Verification and observability inventory

### Slice 0 cross-flow baseline — implemented 2026-08-24

`scratch/capture_cross_flow_architecture.js` now runs one 14-piece synthetic wardrobe through the
active deterministic exports for context, trust/filter eligibility, visual roster, selected-piece
candidates, plan workbench, capsule roster/bench, core/freeform/whole/plan validation, selected
fallback, and plan completion. It is isolated in a temporary SQLite database, fixes the reference
date, forbids network weather lookup, and calls no provider.

The committed `test/fixtures/cross_flow_architecture_baseline.json` captures three shared request
contexts, five identical outfit structures across four validator surfaces, and two recovery paths.
`test/crossFlowArchitectureBaseline.test.js` makes both the exact capture and the required surface
coverage permanent tests.

Run:

```bash
npm run test:architecture:baseline
node scratch/capture_cross_flow_architecture.js       # inspect current JSON
node scratch/capture_cross_flow_architecture.js --write # deliberately accept a reviewed change
```

The first capture records architecture evidence rather than only the triggering layering case:

- With a fixed August date, `current season` resolves hot in the heuristic context while the same
  scenario carries an explicitly supplied neutral weather profile. Existing stages do not all use
  the same source.
- A persisted “no fixture boots in summer” owner constraint suppresses the boots in the shared
  trust and whole-filter results. The neutral visual roster and plan workbench retain them because
  those paths assemble eligibility/context differently.
- An otherwise valid shoe with missing comfort metadata is allowed by the shared trust aggregate,
  excluded by the hiking visual roster, and retained in other bounded sets according to their own
  unknown-data policy.
- A five-image visual cap, four-piece selected-candidate cap, six-piece capsule budget, and
  five-piece capsule bench target record what each independent truncation strategy protects or
  drops under pressure. In the first capture, the five-image visual policy returns only one top and
  one bottom—no shoes—because its category ceilings round small capacities down independently; the
  selected four-piece set retains two bottoms and two shoes, while the capsule paths protect a
  different category mix. This is a candidate-set architecture finding, not a layering finding.
- Missing shoes and duplicate shoes agree at the hard-validity level but expose four different
  result shapes and messages.
- A dependent top without a base is accepted by the narrow core, freeform-role, and whole validators
  but rejected by plan validation. A dress-plus-top structure is accepted by the narrow core and
  whole validator, rejected by freeform roles, and rejected by plan validation for missing recorded
  direction and sight.
- Selected fallback constructs a replacement direction directly; plan completion mutates the
  submitted outfit and revalidates it. Both are captured as recovery behavior, not treated as one
  implementation.

These are baseline facts, not ratified desired behavior. A consolidation slice may change them only
with reviewed policy, an explained baseline update, caller migration, and deletion of the replaced
implementation.

Existing offline coverage already exercises the main owners:

- selected ranking and category preservation in selected-candidate tests;
- visual roster gates, supply-aware behavior, caps, and hot-weather parity in
  `visual_composer_roster.test.js` and `hot_weather_ranking.test.js`;
- whole advisor/gate disposition in `spec9_advisor_mode_precompose_fallbacks.test.js`;
- freeform route/tool contracts in `aiEndpointContracts.test.js`;
- capsule roster, capacity, completion, structure diagnosis, submission validation, expansion, and
  deterministic repair in `plan_outfit_set.test.js` and `aiEndpointContracts.test.js`;
- prompt/style and text-matching architecture ratchets in the repository-wide test suite.

Missing tests that should precede implementation:

- one cross-flow fixture harness that records every shared stage for the same inputs;
- context-provenance parity across direct routes, tools, and plan slots;
- underlying eligibility-finding parity with different approved flow policies;
- validation-finding parity separated from disposition;
- one shared layer/base fixture matrix across freeform, capsule, selected, and whole consumers;
- primary-versus-fallback hard-verdict parity for selected local and absolute backfills;
- structural coverage surviving every hard cap when capacity permits;
- impossible capacity producing a named shortfall at every bounded roster consumer;
- structured core reason codes shared by boolean validation and human-readable diagnosis;
- capsule expansion fallback capacity parity with the saved canonical slot capacity.

No paid model, vision, image, database mutation, ranking change, or production behavior change was
performed for this Stage 1 census.
