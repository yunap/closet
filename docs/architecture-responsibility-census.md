perl: warning: Setting locale failed.
perl: warning: Please check that your locale settings:
	LC_ALL = "C.UTF-8",
	LC_CTYPE = "C.UTF-8",
	LANG = "C.UTF-8"
    are supported and installed on your system.
perl: warning: Falling back to the standard locale ("C").
# Closet architecture responsibility census

**Status:** Active — Stage 1 and Slices 0–7 complete as of 2026-08-25. The product-policy
questions that had blocked the final Slice 1 and Slice 3 consumers are ratified in §7. **Amended
2026-08-26** to add the sleeve layer-pair construction verdict, a seventh layering/base-layer
contract found missing by a live-incident census (§4.5) and closed the same day. **Amended
2026-08-26 again** for a broader prompt-responsibility census's two findings: a
`layerDirectionPromptRule()` projection closing the layer-direction gap the same way (§4.5), and a
verified — not merely suspected — evaluator duplication fix in `OUTFIT_EVALUATOR_GATE_SYSTEM` (§4.5).

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

Closet now has reusable executable modules for context resolution, automatic-use eligibility,
dependency-aware structural coverage, wearable validation, validated recovery, and result
normalization. Each major flow still assembles its own sequence because selected-piece,
whole-wardrobe, freeform, plan, and capsule are different products with different ranking,
composition, cost, and retry policy. That orchestration difference is intentional; a single
mega-pipeline is not the target.

The remaining architecture risk is narrower. A new or legacy adapter can still recreate a semantic
decision outside the shared interface, or a flow-specific selector can be mistaken for shared
meaning. When that happens:

- a fixed rule reaches some products but not others;
- a fallback can bypass a constraint enforced by the primary path;
- tests prove one implementation while another remains wrong;
- missing context is resolved differently before the same shared gate runs;
- a new hard cap can remove structural supply unless it consumes the shared coverage contract;
- telemetry cannot compare flows at the same stage because their stage boundaries differ.

The architecture target remains **shared executable stages with flow policy passed as data**.
Selected-piece, whole-wardrobe, freeform, and capsule remain distinct products, but their
orchestrators call the same context, eligibility, structural-coverage, validation, and recovery
implementations where those semantics apply. Ranking, retrieval, composition, and cost strategy may
vary; fundamental meaning must not be reimplemented.

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
| `unresolved` | Intent, evidence, or missing-data semantics require a named decision before code changes. |

A function can have different classifications for different decisions. For example,
`buildVisualComposerRoster` is a specialization for photo-budget policy and an adapter over shared
eligibility and structural-coverage verdicts.

---

## 3. Active outfit-producing pipelines

This matrix is the compact ownership view. The linked flow documents remain the sequence
authority.

| Flow | Source and context | Eligibility / ranking / bounded set | Composition | Validation and disposition | Fallback / response |
|---|---|---|---|---|---|
| Selected-piece visual composer | `resolveStylingContext` combines named request/state evidence; active anchor and piece memory remain distinct inputs | `selectAutomaticUseCandidatesForOutfitGeneration` injects shared findings into the selected score/category-quota strategy, then `evaluateVisualComposerPiecePool` applies visual policy with the anchor protected | `composeSelectedPieceVisualWardrobeOutfits`, one visual composer call when complete supply exists | `evaluateWearableOutfit` supplies hard structure/dependency findings; selected policy preserves paid invalid attempts and an unsupported selected dependent anchor as Needs review | `buildLocalFallbackOutfitDirections`, then absolute basic backfill, both revalidated; returned as structured outfit cards. See [selected-piece-composer.md](flows/selected-piece-composer.md). |
| Selected-piece text / ideal edge branch | Same anchor and memory; free-text route can enable `idealMode` | Same selected candidate rank; optional `rankSelectedPieceCandidatesWithVision` reorders | `composeStructuredOutfitsForPiece` may suggest missing pieces | `locallyGateOutfitDirections`, optional evaluator gate, selected sanitization | Local fallback and absolute backfill preserve non-empty response. See [selected-piece-composer.md](flows/selected-piece-composer.md). |
| Piece concept boards | Selected piece plus supplied structured outfits or concept text | `selectAutomaticUseCandidatesForOutfitGeneration` with a larger support limit; allowed IDs fixed before planning | Reuses supplied structured outfits, parses concept text, or calls the board planner once; then image rendering per accepted board | ID allowlist, selected-anchor insertion, dedupe, minimum two pieces; no full shared outfit validator | Unusable boards are skipped; zero usable boards is an error. See [piece-concept-boards.md](flows/piece-concept-boards.md). |
| Whole-wardrobe Visual Composer | `resolveStylingContext` combines request, saved artifact, and established state with field provenance | `evaluateAutomaticUsePiecePool` with saved-Main/hot-outerwear policy, then `evaluateVisualComposerPiecePool` and visual relevance/caps | Whole-wardrobe visual composer | `evaluateWearableOutfit` supplies hard structure/dependency findings to the advisor gate; hard-invalid paid attempts remain visible as Needs review even when sibling looks pass | Local candidate backfill fills valid-card shortfall without consuming or hiding paid Needs review cards. See [use-my-wardrobe.md](flows/use-my-wardrobe.md). |
| Saved-outfit Similar / Creative variants | Saved outfit IDs, chosen Main piece, source occasion/season, mode | Adapter calls `generateWholeWardrobeOutfitsVisualInternal`; saved seed and Main piece alter framing and comparison guidance, not gate ownership | Same whole-wardrobe visual composer | Same advisor-mode validation | Same whole-wardrobe fallback; response adds source-outfit debug. See [saved-outfit-variants.md](flows/saved-outfit-variants.md). |
| `/ask` serial search → propose | `resolveToolStylingContext` delegates named thread/action/request evidence to `resolveStylingContext`; ephemeral evidence stays in `toolContext` | `search_wardrobe` consumes `evaluateAutomaticUsePiecePool`, then applies retrieval ranking, supply-aware broadening, and per-category image budget. It is retrieval, not a finite outfit roster | Model calls `propose_outfit` with explicit role assignments | ID retrieval/sight gates, `evaluateWearableOutfit`, shared eligibility findings with strict proposal disposition, and output guards; a rejected attempt remains visible as needs-review | Model may search or propose again within the ten-iteration tool loop; accepted cards govern closing prose. See [freeform-stylist-chat.md](flows/freeform-stylist-chat.md). |
| `/ask` bounded `generate_outfits` | Fresh request classified as bounded or tool-selected bounded generation | Tool resolves shared context; selected-piece requests delegate to `generateOutfitsForPieceInternal`, otherwise to `generateWholeWardrobeOutfitsVisualInternal` | Nested selected or whole composer call; usage is recorded into the parent turn | Delegated flow validation plus accepted-card output guards | Incomplete direct routing falls through to the full stylist; nested flow fallbacks remain active. |
| `/ask` coordinated plan | Each normalized slot delegates named evidence to `resolveStylingContext` and retains provenance | `buildPlanSlotWorkbench` consumes `evaluateAutomaticUsePiecePool`, then applies plan-owned ranking and workbench caps | Model submits via `submit_plan_outfits` | `completeSubmittedPlanOutfits` may fill structural absence; `validateSubmittedPlanOutfits` consumes `evaluateWearableOutfit` before slot, set, repetition, and ownership extensions | Failures are returned to the tool loop for revision; accepted and rejected plan cards are assembled separately. See [freeform-stylist-chat.md](flows/freeform-stylist-chat.md). |
| Atomic seasonal capsule | Same plan entry, `plan_kind: seasonal_capsule` | Capsule slot unions and elevated-demand reserves consume `evaluateAutomaticUsePiecePool`; `selectCapsuleRoster`, `buildCapsuleBench`, optional model selection, postconditions, core capacity and rotation remain capsule strategy | `composeCapsulePlanOnce`, one structured visual composition of the complete rotation | `completeSubmittedPlanOutfits`, then `validateSubmittedPlanOutfits`; utilization and shortfalls are disclosed | Rejected cards are assembled as needs-review; saved versioned plan context enables follow-ons. Capsule behavior authority: [capsule-index-and-plan.md](capsule-index-and-plan.md). |
| Capsule expansion | Saved capsule context, one slot, existing looks | Reload only active saved-roster IDs; intersect slot allowed IDs; stop locally when saved/fallback core capacity is exhausted | One strict structured model call | `validateSubmittedPlanOutfits`; no correction call | Accepted card is appended; invalid attempt or exhaustion is visible. See [capsule-expansion-and-repair.md](flows/capsule-expansion-and-repair.md). |
| Capsule repair | Saved capsule context, rejected IDs, sibling looks | Same active saved slot roster; no wider search | Deterministic missing-category addition or same-category substitution | Every attempt passes `validateSubmittedPlanOutfits` | First accepted repair replaces the card; otherwise a 409 discloses no local fix. Zero provider calls. See [capsule-expansion-and-repair.md](flows/capsule-expansion-and-repair.md). |

Image-only rendering, evaluation, comparison, and intake/tagging flows do not create a new outfit
selection and are therefore outside the pipeline matrix. Their provider calls remain indexed in
[flows/README.md](flows/README.md).

### 3.1 Cross-flow reuse scorecard — reconciled after Slice 7

The affected-flow counts use the eleven active outfit-producing pipelines above. A flow counts when
it executes the stage itself or delegates to another active pipeline that does. The count ranks
reach; it does not claim every implementation is byte-for-byte duplicate.

| Shared stage | Affected pipelines | Current reusable core | Independently assembled work that remains | Divergence risk | Priority |
|---|---:|---|---|---|---:|
| Context resolution | 10 consumer families | `resolveStylingContext` owns field precedence, normalization, profiles, weather authority, conflicts, and provenance for direct, freeform, and plan composition consumers | Flow adapters supply named evidence and bounded live-weather policy; storage remains distinct | Reduced: active outfit-producing context consumers no longer own parallel precedence branches | 1 |
| Piece eligibility | 11 | `evaluateAutomaticUsePiecePool` over `wholeWardrobePieceTrustDecision` and narrow verdict helpers | Visual presentation, retrieval broadening, explicit Anchor Piece disposition, and post-composition validation remain named flow policy | Reduced / guarded: all named runtime consumers receive the shared underlying findings; risk is a future adapter reintroducing a private hard gate | 2 |
| Outfit validation | 11 | `evaluateWearableOutfit` composes the canonical category/role structure, required-base, optional direction, unknown-evidence, and sight results | Slot/set/context extensions and disposition remain bounded policy; concept boards intentionally use their lighter allowlist/anchor checks | Reduced: hard wearable meaning is shared while product disposition remains explicit | 3 |
| Candidate-set construction | 10 | `candidateSet.js` owns protected IDs, dependency-aware structural coverage, hard capacity, and explicit shortfall | Selected quotas, visual photo/category caps, search retrieval budgets, capsule recombination, plan slot ranking, and fallback ordering remain objective-specific policy | Reduced / monitored: outfit-producing caps consume the shared coverage owner; local fallback selection is the remaining parity candidate, while search is intentionally retrieval-only | 4 |
| Recovery and fallback | 8 | `recovery.js` owns validated substitute, complete, fallback, and shortfall mechanics; flow strategies inject their authoritative validator | Candidate ordering, retry/cost budgets, and visible disposition remain flow policy; diagnostic broken cards remain explicitly rejected evidence rather than accepted recovery | Reduced: no migrated mutation can return as recovered before its primary hard validator accepts the exact result | 5 |
| Prompt fact projection | 10 | Style Constitution exports plus structure/finding serializers in `outfitValidation.js` | Flow prompts still own composition strategy and output schema; unrelated context and eligibility facts remain later projection work | Reduced for migrated structure facts: validator wording is emitted by its owner instead of independently restated | 6 |
| Response normalization | 11 | `outfitResult.js` normalizes delivered outfit disposition, findings, annotations, repair capability, and provenance | Flow labels, display copy, plan context, UI actions, and legacy aliases remain local | Reduced: selected, whole, freeform proposal, plan, capsule expansion, and capsule repair now expose the same semantic envelope | 7 |
| Provider invocation and usage | 10 provider-crossing pipelines | `askStylist*` abstraction and telemetry context | Nested-call attribution and direct image/Responses calls remain specialized | Medium but well documented; no broad rewrite justified now | 8 |

No scorecard stage remains Critical after the completed Slice 0–7 consumer migrations. “Reduced”
does not mean “finished forever”: it means the semantic owner exists, named consumers use it, and
remaining differences are explicit policy or bounded roadmap work. The residual risks and their
evidence gates are recorded in
[post-254-architecture-roadmap.md](post-254-architecture-roadmap.md). Provider unification remains
lower priority because it has less effect on domain behavior and is already substantially shared.

### 3.2 Shared-stage composition model

This is a responsibility model, not a required universal orchestrator or call stack:

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

The names are illustrative; the contracts matter. Existing flows may call these responsibilities
through their own adapters and in a different order where the product requires it. A flow policy may choose an anchor ranking,
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

**Canonical direction:** Keep the ownership chain `field reference/schema → attributes reader →
domain verdict → projection`. `pieceTextBlob` remains a real duplicate candidate, not approved
policy. Before migration, compare both blobs over structured, missing-data, notes-heavy, and
learned-rule fixtures and classify every difference. If it is projection-only, rename it; if it
drives semantics, move those decisions behind attribute readers. Until that comparison exists,
deletion is not authorized. This is roadmap R1, not an unfinished Slice 2 consumer migration.

### 4.2 Eligibility and hard gates

**Semantic contract:** Given a piece and resolved context, return whether automatic use is
allowed, plus structured reasons and evidence confidence. Flow strategy may add stricter roster
requirements but may not redefine the underlying verdict.

| Decision surface | Current decision | Classification | Active consumers |
|---|---|---|---|
| `wholeWardrobePieceTrustDecision` | Aggregate owner constraint, occasion/register, weather, activity, footwear, and auto-styling trust for one piece | `canonical` aggregate for automatic-use eligibility | Selected ranking, whole filtering/scoring, freeform search/propose/swaps/generate, plan workbench, repairs |
| `profileRuleFit`, `footwearComfortVerdict`, `registerCeilingVerdict`, weather and occasion readers | Narrow contextual verdicts | `canonical` primitives | Trust aggregate, visual roster, scores, plan validation, search |
| `evaluateAutomaticUsePiecePool` | Canonical pool projection over the shared per-piece verdict and capacity policy | `canonical` pool owner | Selected ranking, whole generation, freeform tools, plans/capsules, recovery, tracked diagnostics |
| Selected-piece anchor bypass | Keep the user-selected premise even when ordinary auto-use gates would exclude it | `specialization` | Selected visual/text composers and boards |
| `buildVisualComposerRoster` | Photo availability, metadata completeness, supply-aware register/activity policy, visual relevance, category ceilings and global image cap | `specialization`; `adapter` over shared eligibility and coverage verdicts | Selected visual and whole visual composers |
| `search_wardrobe` filtering and broadening | Active/category/owner exclusions are fixed; descriptive and occasion filters may relax with disclosure | `specialization` | Freeform serial retrieval |
| Capsule slot filtering in `buildPlanSlotWorkbench` and capsule selectors | Shared automatic-use findings plus slot weather/activity/register; finite budget, capsule supply, and postconditions remain plan strategy | `adapter` to shared eligibility plus `specialization` | Coordinated plans and capsules |
| `evaluateOutfitRoles` / `validateSubmittedPlanOutfits` per-piece checks | Reject a composition after selection | Typed role-structure owner and plan validation orchestration; eligibility delegation is covered below | Freeform cards and plan submissions |

**Intentional differences**

- A selected anchor is explicit user input, not an automatically recommended candidate.
- A visual roster may require a usable photo and fit within a hard provider image budget.
- Search broadening preserves hard exclusions but may relax soft discovery filters and tells the
  model what changed.
- Supply-aware roster policy can distinguish “unknown/inappropriate but alternatives exist” from
  “only available supply,” provided the relaxation is disclosed.

**Canonical owner:** `wholeWardrobePieceTrustDecision` remains the aggregate answer to “may the app
automatically use this piece in this context?” Its narrow inputs remain owned by their fact and
verdict helpers. Visual-photo eligibility, finite roster capacity, and explicit anchor override stay
outside it as named policy layers.

**Owner ruling applied, 2026-08-25:** A selected anchor may bypass automatic-use eligibility.
Missing photographs or metadata are not global invalidity. Sparse supply may relax only soft
ranking/presentation preferences; hard constraints and known incompatibilities remain binding.
Unknown evidence blocks only when needed to prove a hard requirement and may otherwise proceed to
sight-backed model judgment or explicit uncertainty disclosure.

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

**Canonical direction:** Do not create a universal score. Share fact readers and hard verdicts; keep one
named strategy per objective with reason strings. The roster-coverage contract in §4.4 operates
after ranking and before hard truncation.

**Migration constraint:** Any ranking or attribute-reader change requires the repository ranking
A/B diff and an explanation for every changed ordering. A pure orchestration move must produce a
zero diff.

### 4.4 Roster and retrieval construction

**Implemented shared semantic contract:**

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
| `buildVisualComposerRoster` | Category ceilings and provider cap behind `buildCoveredCandidateSet`; returns a coverage report | `specialization` over the shared coverage contract |
| `search_wardrobe` | Per-category result and image budgets; no claim to form a finite outfit roster | `specialization`, not a roster contract consumer unless a caller asks for complete outfit supply |
| `selectCapsuleRoster` | Quotas, reserves, postconditions, explicit supply gaps | `canonical` capsule roster strategy |
| `buildCapsuleBench` | Seeds deterministic roster and protects categories/slots for model selection | `specialization` |
| `selectCapsuleRosterViaModel` | Bounded model selection with allowlist validation and deterministic fallback | `specialization` |
| `buildPlanSlotWorkbench` / `selectPlanWorkbenchPieces` | Slot-specific gate-passing set with a hard workbench limit and explicit structural coverage report | `specialization` over the shared coverage contract |
| Selected and whole local fallback selectors | Directly choose leading candidates, then pass accepted output through shared recovery validation | `specialization` for reduced-ambition ordering; residual `legacy` only where pre-composition coverage is independently assembled, pending parity evidence |

**Shared invariants**

- Ranking and global truncation may not silently remove the last eligible member of a required
  structure when capacity can preserve it.
- Protected anchors survive.
- Dependency requirements participate in capacity, rather than being discovered only after model
  composition.
- Impossible capacity returns a named shortfall; it does not overflow the provider limit or weaken
  a hard gate.

**Implemented owner:** A small dependency-neutral structural-coverage verdict, separate from the
selected, visual, search, and capsule selectors. Do not place the generic contract inside
`outfitSetPlanner.js`, which would give capsule/plan orchestration false ownership.
`candidateSet.js` owns the contract and its coverage report. Outfit-producing flows preserve a
complete structural path whenever eligible supply exists; retrieval-only search may return partial
supply with an explicit gap.

The selected quota, visual cap, capsule roster/bench, plan workbench, and search budget are not
therefore one unresolved duplicate implementation. They optimize different objectives. The shared
interface owns only structure under capacity; callers own ranking and product budgets. Local
fallback selection is the remaining bounded parity candidate. See roadmap R3.

### 4.5 Layering and base-layer semantics

There is intentionally no single “layering” owner. The overloaded concept is split into seven narrow
questions with separate fact/verdict owners and one composed wearable verdict.

| Contract | Current surfaces | Current missing-data behavior | Classification / owner |
|---|---|---|---|
| Dependent status: does this piece need something beneath it? | Structured `needs_base` through `pieceRequiresBaseLayer`; prompt lines are projections | Only explicit `yes` is dependent; unset and explicit `no` preserve the independent default | `canonical` reader in `attributes.js`; candidate, capsule, fallback, rendering, and swap decisions consume it |
| Independent coverage: can this top provide usable torso coverage by itself? | `evaluateBaseLayerCandidate` | Capsule may reserve `unknown`; known dependence, sheer/open opacity, or loose fit is incompatible | `canonical` typed verdict in `outfitValidation.js`; flow policy decides whether `unknown` may reserve capacity or requires sight |
| Pair mechanics: can base A physically sit beneath dependent piece B? | `evaluateRequiredBaseLayers`, consumed by plan submission and freeform proposal/swap validation; visual composer prompt projects the same close-fit values | Missing opacity or fit returns `unknown` with `sightRequired: both` | `canonical` typed pair/outfit verdict consuming the structured coverage verdict |
| Layer direction: which piece may sit over/under which? | `evaluateLayerDirections`, consuming `pieceHasExplicitTopLayerEvidence`, `pieceHasExplicitBaseLayerEvidence`, `pieceDressSupportsUnderlayer`, dependency, role and category facts; projected pre-composition by `layerDirectionPromptRule()` (added 2026-08-26) | Missing direction is `unknown`; both photos are required, after which the model may make a provisional one-turn judgment | `canonical` typed verdict in `outfitValidation.js`; plan submission, freeform proposal, and participating slot swaps consume *validation*; visual composer, `propose_outfit`, and the shared plan/capsule workbench now also cite the *projection* pre-composition, replacing a private "TOP + DRESS LAYERING" paragraph `capsulePlanCompositionSystemPrompt` had invented independently |
| Sleeve construction: does this pair's own sleeve bulk physically conflict when layered, independent of direction? | `evaluateLayerPairConstruction` / `evaluateLayerPairConstructionFor`, consuming `pieceSleeveLayerEvidence` (`attributes.js`: `sleeve_length`, `sleeve_shape`, `fabric_weight`); projected pre-composition by `layerConstructionPromptRule()` | No cuff overlap possible (short/sleeveless base) is deterministically compatible; both cuffed with unrecorded shape/weight is `unknown` and stays an advisory finding, not a sight-forcing gate — see below | `canonical` typed pair verdict in `outfitValidation.js`, added 2026-08-26; `propose_outfit`, plan submission, and capsule composition inherit *validation* through the same `includeLayerDirections` opt-in as layer direction, and now also cite the canonical *prompt projection* before composing (visual composer, `propose_outfit` tool description, shared plan/capsule slot workbench); `garment_fact` projects the identical verdict instead of restating thresholds in prose |
| Sight requirement: must photos be inspected? | `evaluateRequiredBaseLayers`, `evaluateLayerDirections`, and `evaluateWearableOutfit`; tool/plan adapters enact it | Shared results name required IDs/pairs; disposition still varies when photos are unavailable | Canonical evidence requirement in `outfitValidation.js`; unavailable-evidence disposition is roadmap R4. Sleeve construction is a deliberate exception — see below |
| Visual success: do neckline, bulk, texture, color, and proportion work? | Visual composer and stylist model | Not deterministically inferable | Model-owned judgment; never converted into keyword taste rules |

**Added 2026-08-26 — sleeve construction was a genuine seventh gap, not a duplicate.** A
[freeform-prompt-ownership.md](freeform-prompt-ownership.md)-style census of PR 263 found a private
prose rule added directly to `compactFreeformAnswerSystem('garment_fact')` (citing the retired
`sleeve_type` field, never even supplied to that prompt) after `thread_1787728618995` confidently
called a long-sleeve-over-long-sleeve pairing compatible with no construction check at all. A
follow-up correction proved the same gap existed in `evaluateWearableOutfit` itself: neither
`evaluateRequiredBaseLayers` (scoped to `needs_base` dependents) nor `evaluateLayerDirections`
(over/under direction only) reads `sleeve_length`, `sleeve_shape`, or `fabric_weight`, so
`propose_outfit`, plan submission, and capsule composition could already accept a real sleeve-bulk
conflict. `evaluateLayerPairConstruction` closes that gap as its own narrow verdict rather than
folding into `evaluateRequiredBaseLayers` or `evaluateLayerDirections` — it answers a different
question (construction bulk, not dependency or direction) and stays independently testable. Two
cuffed sleeves worn one over the other is deliberately **not** treated as inherently incompatible:
the verdict requires actual bulk evidence (a voluminous `sleeve_shape`, or both garments tagged a
medium/heavy `fabric_weight`) before returning `incompatible`.

**Deliberate asymmetry with the sight-requirement contract:** an `unknown` required-base or
layer-direction pair enters `unresolvedSightPairs` and blocks composition until both garments are
seen, because that unknown only exists where a real dependency or an explicit overlay/underlayer
signal was already found. An `unknown` sleeve-construction verdict does **not** — missing
`sleeve_shape`/`fabric_weight` is common on ordinary, unremarkable layering pairs across this
wardrobe corpus, and escalating every one to a mandatory-photo gate would block routine composition
for a data-completeness issue rather than a suspected conflict (confirmed against the live
cross-flow test suite, which failed under the stricter version). Only a *proven* conflict is a hard
`evaluateWearableOutfit` finding; an unresolved one remains a visible advisory finding only. This is
a considered exception to the general sight-requirement pattern, not an oversight — record it here so
a future slice does not "fix" it into parity with the other two pair verdicts.

**Prompt-projection follow-up, same day.** The initial landing gave every consumer post-composition
validation but left composition itself blind to the rule — no active composer told the model about
sleeve-construction compatibility before it composed, which is the exact private-restatement risk
this fix exists to prevent (a composer would otherwise have had to invent its own advance-guidance
prose, independently worded, per prompt). `layerConstructionPromptRule()` (mirroring
`requiredBaseLayerPromptRule()`'s established pattern from §4.6) is now cited by every active
layering-capable composer rather than restated: `WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM` (one template
shared by both the whole-wardrobe and selected-anchor visual composer), the static `propose_outfit`
tool description, and `buildPlanSlotWorkbench` (`outfitSetPlanner.js`) — one wiring point for both
plan and capsule, since `composeCapsulePlanOnce` forwards that workbench's `instructions` and per-slot
`submission_requirements` directly into the atomic capsule composer's prompt. The workbench projection
is gated to slots whose own roster can actually form a layering pair, so it is signal rather than
blanket cost. `styling_context_consumers.test.js` proves the visual composer and `propose_outfit`
cite the rule verbatim (source and runtime); `plan_outfit_set.test.js` proves the live workbench
projects it for a layering-capable slot and withholds it for one that cannot layer.

**Gate correction, same day.** The workbench gate's first version answered "can this slot layer" by
counting `top`/`dress`-category pieces only — its own local definition of layering eligibility,
independent of the one `evaluateOutfitRoles` already uses. That missed the canonical `layer_top`
assigned to an `outerwear`-category piece (a jacket over a top), since `outerwear` is not `top` or
`dress`. Fixed by exporting `ROLE_CATEGORY_EXPECTATIONS` — the role→category map
`evaluateOutfitRoles`' `role_category_mismatch` finding already used internally — and building
`wardrobeSupportsLayeringPair()` from that same map, so category eligibility for "who may layer" has
one owner instead of two independently-maintained lists. `outfit_structure.test.js` unit-tests the
helper; `plan_outfit_set.test.js` adds the single-top + single-outerwear live fixture the original
gate silently dropped.

**Layer-direction projection, 2026-08-26.** A broader prompt-responsibility census (post-#264) found
`evaluateLayerDirections` was the sole exception among the layering verdict family: validated
post-composition for `propose_outfit`/plan submission, but never projected pre-composition anywhere,
and `capsulePlanCompositionSystemPrompt` had filled that gap with a private "TOP + DRESS LAYERING"
paragraph independently worded from the actual evidence sources (`pieceHasExplicitTopLayerEvidence`,
`pieceHasExplicitBaseLayerEvidence`, `pieceDressSupportsUnderlayer`, `pieceRequiresBaseLayer`).
`layerDirectionPromptRule()` closes it, wired at the same three points as `layerConstructionPromptRule()`
(visual composer, `propose_outfit`, plan/capsule workbench, gated by the same `wardrobeSupportsLayeringPair()`
supply check); the private paragraph is deleted. No disposition change: `evaluateLayerDirections`'
`unknown`/sight-required behavior is untouched, only its pre-composition visibility changed.

**Projection-accuracy correction, same day.** The first `layerDirectionPromptRule()` omitted
`pieceRequiresBaseLayer` as a direction signal — the role-aware `layer_top + primary_top` branch
treats a dependent `layer_top` (`needs_base: yes`) as evidence it sits *over* its primary top, with
no overlay text required (`evidence.source: 'dependent_layer_requires_base'`). It also conflated
relationship with direction: "two pieces merely appearing together is not evidence of a layering
relationship" is false for a role-aware `layer_top + primary_top` pair, where role assignment already
establishes the relationship — only the direction can be unknown. The projection now says role/
category assignment may establish that a pairing is intended to layer, while construction/intent/
dependency evidence (including `needs_base` on either the added piece or the dress) decides the
direction. `outfit_structure.test.js` ties the prose directly to the same `needs_base`-only fixture
`propose_outfit.test.js` pins for the executable verdict, so a future prose edit that silently drops
the branch fails even if `evaluateLayerDirections` itself is untouched.

**Second projection-accuracy correction, same day.** The rewrite above still over-claimed: it said
role/category assignment never decides direction by itself, but that is false for an
outerwear-category `layer_top` — `categoryGroup === 'outerwear'` alone resolves
`layer_top_over_primary_top` (`evidence.source: 'outerwear_category'`), no notes or dependency
required, unlike a `layer_top` role on an ordinary top (relationship only). The projection now
distinguishes the two explicitly. Same test pattern: a behavioral fixture in
`propose_outfit.test.js` and a matching prose-content check in `outfit_structure.test.js`.

**Evaluator register/footwear verification, 2026-08-26.** The same census flagged
`OUTFIT_EVALUATOR_GATE_SYSTEM` (the selected-piece text/ideal composer's post-composition audit,
`styling-engine/core.js`'s `composeStructuredOutfitsForPiece`) for independently re-deriving
register-ceiling and footwear-suitability semantics in free prose. Call-chain tracing confirmed this
is real, not merely wording overlap: every supporting candidate reaching that evaluator already
passed `registerCeilingVerdict`/`footwearComfortVerdict` (via `selectAutomaticUseCandidatesForOutfitGeneration`
→ `evaluateAutomaticUsePiecePool` upstream), but the **selected anchor** bypasses automatic-use
eligibility by ratified 2026-08-25 design and so never runs those checks — the evaluator's prose was
the only place they could apply to it, and free-form "clearly exceeds"/keyword judgment ("stilettos,
delicate sandals, high heels") can reach a different verdict than the canonical functions on the same
piece. Fixed narrowly: `anchorRegisterFootwearComputedChecks()` (`core.js`) computes the anchor's own
verdict server-side and supplies it as a labeled computed line; the evaluator's prose now defers to
that line instead of re-deriving suitability, and is told explicitly not to flag register/footwear
absent one (since every other candidate is already guaranteed compliant). `EDITORIAL_NEW_PIECES_SYSTEM`'s
near-identical-sounding doctrine was traced separately and left untouched — it operates on
conceptual, not-yet-tagged pieces with no fields to compute a verdict from, so no canonical owner is
possible there; that overlap is legitimate, not duplication.

**Remaining gap:** Pair mechanics, dependency validation, recovery, and capsule capacity now consume
the shared verdict family. The unresolved edge is disposition when a required visual fact is
unknown and one or both photographs are unavailable: the verdict can require sight that the flow
cannot obtain. That must become explicit disclosure or Needs review policy rather than a futile
retry or a guessed fact. See roadmap R4.

**Implemented result family:** `{ verdict: 'compatible' | 'incompatible' | 'unknown', reasons,
evidence, sightRequired }`, composed into `evaluateWearableOutfit`. Dependent status and independent coverage expose narrower verdicts,
while pair mechanics consumes both pieces. Flow policy decides what to do with `unknown`; the
fact owner does not silently turn it into allow or reject.

**Owner ruling, 2026-08-24:** capsule capacity and finite-roster reservation may retain unknown
historical candidates; sight/model-backed outfit submission requires both the dependent and
candidate base to be seen when fit or opacity is unknown. Known incompatibility is deterministic.
This close-fit contract is scoped only to a garment whose card says “Needs a base layer”; ordinary
inner-garment/outer-layer styling is a separate direction and visual-fit question. The selected
dependent anchor remains the user's premise even when automatic eligibility would exclude it. The
dependency is never waived: without a compatible base, the selected flow preserves the anchor as
an incomplete Needs review card carrying the hard dependency reason.

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
| Local candidate generators | Deterministic reduced-ambition composition | `specialization`; shared recovery validation owns hard acceptance, while pre-composition selection parity remains roadmap R3 |

**Implemented owner, 2026-08-25:** Domain invariants originate in code/data verdicts and have one
serializer that projects the result into each prompt that needs it. `outfitValidation.js` now owns
category-structure, explicit-role, and typed-finding projections consumed by whole visual,
freeform proposal, plan workbench, and capsule expansion prompts. Flow prompts continue to own
strategy and output shape; no prompt was merged and no cache boundary moved.

**Ratchet status:** Slice 7 covers shared structure/role/finding projections and their mechanical
validators. Context and eligibility facts do not yet have equivalent coverage across every prompt;
add such a fixture only when a canonical fact has two active projections or live evidence shows a
prompt/validator contradiction. Prompt presence alone is never enforcement. See roadmap R5.

### 4.7 Outfit validation

| Decision surface | Verdict | Classification | Disposition |
|---|---|---|---|
| `evaluateOutfitStructure` | Typed category-level core: top+bottom or dress, shoe count, conflicting categories | `canonical` narrow structural verdict | Diagnosis and `evaluateWearableOutfit` composition |
| `describeOutfitStructureGap` | Primary-finding message projection of `evaluateOutfitStructure` | `projection` | Capsule repair diagnosis and plan failures |
| `locallyGateOutfitDirections` | Anchor present, minimum piece count, no duplicate IDs | `specialization`, not a full validator | Reject selected text directions |
| `sanitizeSelectedPieceOutfitDirections` | Selected layer coherence and cleanup | `specialization` | Remove or normalize selected results |
| `locallyGateWholeWardrobeOutfits` | Composes typed category structure with ownership, context/profile findings, and diversity | `adapter` plus disposition specialization | Structural errors reject in both modes; advisor annotates many later concerns and does not reinvent |
| `evaluateOutfitRoles` | Typed explicit-role cardinality, shoes, primary core, and role/category compatibility | `canonical` explicit-role structure; ordinary layer direction is a separate verdict | Freeform proposal and slot-swap consumers project finding messages |
| `evaluateLayerDirections` | Typed known/unknown over-under relationships, evidence source, per-pair sight requirement, and provisional visual-resolution marker | `canonical` ordinary-layer direction; missing metadata never proves incompatibility | Plan submission, freeform proposal, and direction-participating slot swaps |
| `evaluateWearableOutfit` | Composes category/role structure, required-base mechanics, optional direction evidence, hard/advisory findings, and unresolved sight pairs | `canonical` shared wearable verdict | Selected, whole, freeform proposal/swap, plan submission, and recovery validators |
| `validateCapsuleRoster` | Finite roster quotas, base/structure supply, slots and budget | `specialization` | Reject or report roster gaps |
| `validateSlotOutfitConstraints` | Slot weather/activity/register/season and plan requirements | `specialization` | Failure reason for plan submission |
| `validateSubmittedPlanOutfits` | Composes typed category structure with ownership, dependency, slot, repetition, core uniqueness, and set rules | `canonical` plan validator / orchestration | Accept or return structured failures |
| Route-local board filters | Allowed IDs, anchor, dedupe, minimum piece count | `specialization`; incomplete by design for concept boards | Skip unusable boards |

**Implemented owner, 2026-08-25:** `evaluateOutfitStructure`, `evaluateOutfitRoles`,
`evaluateRequiredBaseLayers`, and `evaluateLayerDirections` remain narrow fact/verdict owners;
`evaluateWearableOutfit` owns their composition and separates hard invalidity from unresolved
visual evidence. Hard findings are hard in every flow. Repairable results may enter bounded
recovery, but the exact repair must pass the same hard validator. Advisory findings remain
flow-specific projections. Concept boards intentionally retain their lighter allowlist, anchor,
dedupe, and minimum-piece validation rather than claiming full wearable-outfit validity.

### 4.8 Repair, completion, retry, and fallback

| Surface | What it actually changes | Classification |
|---|---|---|
| `applyComfortFootwearRepair` | Selected-flow footwear substitution under an active comfort constraint | `specialization` consuming shared footwear verdicts |
| `repairWholeWardrobeOutfit` | Normalizes/protects prose and can substitute required footwear; not a general structural repair | `specialization`; name overstates scope |
| `completeSubmittedPlanOutfits` | Adds a missing structural category from the slot's allowed roster, revalidating the set | `canonical` plan completion strategy |
| `/repair-capsule-look` | Deterministic missing-piece addition or one-for-one same-category swap, validating every attempt | `specialization` |
| `/expand-capsule` | No repair; one composition and one validation pass | `specialization` / explicit no-retry disposition |
| Freeform tool-loop correction | Model can act on validation failures in a later iteration | `specialization` / paid retry boundary |
| Selected local fallback and absolute backfill | Reduced-ambition deterministic directions passed through shared validated fallback with anchor, structure, and dependency checks | `specialization` |
| Whole local candidate backfill | Ranked local candidates passed through shared validated fallback using the whole advisor gate | `specialization` |
| Whole diagnostic cards | Surface why acceptable cards could not be produced | `canonical` disclosure disposition for advisor failure |

**Shared invariant implemented 2026-08-25:** Primary, repair, completion, and fallback paths consume the same hard
ownership, eligibility, structure, and dependency verdicts. They may differ in ambition, aesthetic
judgment, retry cost, and whether a soft finding annotates or rejects.

`recovery.js` is the common post-mutation adapter. `validatedSubstitute`, `validatedComplete`, and
`validatedFallback` enumerate caller-ranked candidates and return only exact results accepted by
the injected validator; `discloseRecoveryShortfall` supplies one machine-readable exhaustion shape.
Repair strategy, ranking, and provider budget stay local.

**Owner rulings applied:** selected fallback does not mislabel a structurally/dependency-invalid
substitute as accepted. It discloses the gap; for a selected dependent premise, that disclosure is
an incomplete Needs review card preserving the anchor. An unknown historical base pairing remains
eligible for visual judgment, while an explicitly incompatible pairing cannot pass fallback.

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

**Retained owner:** No provider consolidation is planned without a concrete defect. Preserve the provider abstraction where
already used, and require every nested call to attribute usage to its parent user turn. Direct image
calls remain separate until a correctness or telemetry defect justifies migration.

**Resolved 2026-08-25 (roadmap R6):** `capsuleExpansionCoreCapacity` was parallel to the fuller
capsule capacity owner. The route still prefers saved planner capacity, including a deliberate
zero after cross-slot competition, but a legacy version-1 card with no saved capacity now adapts
its active allowed roster into `capsuleOutfitCoreCapacity`. Comparison fixtures cover an
unsupported dependent top, a dress core, ordinary separate cores, and repeated cross-slot
compatibility; the route-local calculation is deleted and a source ratchet prevents its return.

### 4.10 Conversation state authority per field

Persistent state is stored by `getStylistConversationState` and
`saveStylistConversationState`. `buildStylistConversationPayload` resolves the server payload;
`toolContext` is the mutable one-turn working state; response cards and browser history are UI
handoffs, not interchangeable stores.

| Field | Writer and lifetime | Precedence / authority | Active consumers |
|---|---|---|---|
| Occasion | Request body, tool declarations/plans; persisted when established | Explicit current body wins; persistent server value restores only on a non-new request | Router context, prompts, search, composers, validators |
| Activity | Same as occasion | Explicit current body wins; then established server state | Weather/activity gates, footwear, plan slots, prompts |
| Season | Request body and resolved conversation context; persistent | Explicit current body wins; persistent fallback on continuation. The request value may remain `current season`; the resolver derives `calendarSeason` from the authoritative date for executable applicability | Weather resolution, eligibility, prompts, roster |
| Weather profile | Resolved from explicit/current context and saved as normalized state | Current resolved weather wins; stored profile is continuation fallback, not a new forecast | Visual composer, trust/roster gates, plans |
| Current outfit set | Successful bounded/tool composition; persistent normalized summary plus response cards | Server state is follow-up context; actual response cards are the display/product authority for the current turn | Follow-up resolution, accepted-card guards, UI |
| Active outfit / selected subjects | Request body and thread/body context | Explicit current card/piece reference wins; recovered state assists ambiguous follow-up | Compact profiles, full prompt, tool context |
| Pending plan | `plan_outfit_set` inside one tool loop | Ephemeral and authoritative only for the matching `submit_plan_outfits`; not a general persistent plan store | Plan submission, atomic capsule composer |
| Retrieved piece IDs | Search/workbench/nested composer inside `toolContext` | Ephemeral evidence gate; cannot be reconstructed from prose | `propose_outfit`, sight/ownership guards, diagnostics |
| Visually seen piece IDs | `view_pieces`, visual roster/composer, capsule thumbnails | Ephemeral evidence authority for sight-required claims | Role/plan validation, proposal guards, diagnostics |
| Capsule reusable plan context | Response card payload assembled after accepted atomic plan | Versioned card state; follow-on routes validate it and reload DB rows rather than trusting embedded piece objects | Capsule expansion and repair |
| Browser history/context echoes | `StylistChat.jsx`, per request | Fallback/conversation evidence; does not override explicit normalized server fields | Payload building and model messages |

**Ratified owner, 2026-08-25:** Keep server persistent state authoritative for established conversational fields,
`toolContext` authoritative for one-turn evidence and pending work, and cards authoritative for what
was actually delivered. Document new fields in this per-field form; do not create a second generic
state object. Saved artifacts and persistent freeform state remain distinct named evidence sources
with provenance; `resolveStylingContext` combines them using the field-specific precedence ruling.
Expiry and future server-side capsule persistence remain separate storage-design questions, not
context-authority ambiguity.

---

## 5. Ownership registry after PR 254

| Contract | Canonical owner | Allowed specialization | Residual status / roadmap |
|---|---|---|---|
| Piece text fallback | `attributes.js` readers and `attributePieceTextBlob` | Prompt/tool serializers may choose fields and formatting | `pieceTextBlob` comparison/deletion remains roadmap R1 |
| Automatic-use eligibility | `wholeWardrobePieceTrustDecision` composed through `evaluateAutomaticUsePiecePool` | Anchor override, visual-photo policy, supply-aware disclosed relaxation, finite provider caps | Runtime migration complete; guard adapter drift under roadmap R2 |
| Normalized styling context | `resolveStylingContext`, with `resolveCalendarSeason` as its calendar projection | Flow declares required fields and whether live lookup is permitted; display/request season may remain distinct from calendar applicability | Runtime migration complete; 2026-08-25 live projection defect corrected; separate storage lifetimes remain roadmap R8 |
| Layer/base facts and pair mechanics | Tri-state verdict family in `attributes.js` / `outfitValidation.js`, composed by `evaluateWearableOutfit` — added 2026-08-26: sleeve-construction bulk (`evaluateLayerPairConstruction`) alongside dependent-status, coverage, pair-mechanics, and direction | Flow policy for `unknown`; model visual judgment; sight availability disposition (sleeve construction deliberately does not force sight on `unknown` — see §4.5) | Runtime migration complete; unavailable-sight disposition remains roadmap R4 |
| Outfit core structure | `evaluateOutfitStructure` / `evaluateOutfitRoles`, composed by `evaluateWearableOutfit` | Role, slot, set, advisor/gate disposition | Runtime migration complete; concept-board light validation remains intentional |
| Bounded structural roster coverage | `candidateSet.js` | Selected relevance, visual photo budget, capsule recombination, plan slot limits | Main outfit-producing caps migrated; local fallback parity remains roadmap R3 |
| Ranking | One existing strategy per objective, consuming shared facts/verdicts | Objective-specific weights, diversity, recency, anchor relevance | Hidden gate-like penalties only; do not merge strategies |
| Candidate-set construction | `buildCoveredCandidateSet` for structural coverage under capacity | Anchor relevance, whole breadth, capsule recombination, search retrieval mode | No universal selector planned; objective-specific adapters and R3 define the end-state |
| Repair/fallback validity | `recovery.js` primitives over canonical validators | Flow-local allowed mutations and cost/disclosure policy | Runtime migration complete; naming/locality concern remains roadmap R10 |
| Response normalization | `outfitResult.js`: stable accepted/annotated/repairable/rejected result with provenance, findings, annotations, and optional repair capability | Flow labels, actions, display copy, plan context, and compatibility aliases | Runtime migration complete; alias last-reader removal and new-consumer guard are roadmap R9 |
| Prompt invariant projection | Canonical verdict serializer adjacent to verdict owner | Flow prompt strategy and output schema | Structure migrated; evidence-triggered context/eligibility projection work is roadmap R5 |
| Provider execution | Existing `provider.js` abstraction and flow atlas | Direct image execution when documented | Defect-triggered only under roadmap R7; no broad provider rewrite |
| Conversation state | Per-field authority: persistent server, ephemeral evidence, delivered card | Explicit current-request override and versioned card capability | Lifecycle questions remain separate, defect-triggered roadmap R8 |

---

## 6. Completed Slice 0–7 migration record

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

**Remaining-consumer migration, implemented 2026-08-25:** `resolveToolStylingContext` is the
freeform adapter for search, proposal, slot swaps, and bounded generation; it passes current
request, action artifact, established thread state, and inference as named evidence rather than
reordering them locally. Plan workbenches resolve every slot through `resolveStylingContext` before
capsule selection, gating, or composition and retain the context/provenance on the slot. The former
freeform stated/live weather resolver and occasion-switch activity reset were retired; the reset is
now a field-specific resolver policy. Saved artifacts and persistent thread state remain separate
evidence sources. An explicitly supplied weather profile, including indoor/transit profiles, is
preserved without being reinterpreted by a caller.

**Live-validation correction, implemented 2026-08-25:** Slice 1 had centralized source precedence
but had not made the semantic projection of executable applicability part of its returned contract.
Consequently, accepted summer guidance could be absent from a current-season prompt even though a
hard owner constraint used a different local season resolver. `resolveStylingContext` now returns
both the preserved request `season`, canonical `calendarSeason`, and an `applicabilityContext`;
all executable applicability shares `projectStylingApplicabilityContext`. That projection uses
`resolveCalendarSeason`, the authoritative request date, and normalized hot/cold/rain/wet-exposure
facts from the resolved Weather Profile. Direct selected/whole, freeform and plan/capsule feedback
consumers pass this shape, while eligibility receives its Calendar Season and date. Plan slots now
keep Requested Season separate from `statedWeather`, and freeform search/propose/swap no longer
drop the request date. Tests cover summer/winter dates, indoor summer slots, structured rainy
weather, accepted lessons, direct guidance, historical reactions, and freeform eligibility. This
is a completion correction to the Slice 1 meaning contract, not a reopening of candidate
construction or a new style rule.

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
policy and saved-Main bypass changes only effective disposition. At migration, direct parity
fixtures preserved selected ordering/reasons, and the then-current cross-flow baseline proved the
pool matched the old whole filter before Slice 7 retired both duplicate comparisons.
**Fourth-consumer migration, 2026-08-24:** coordinated-plan workbenches, capsule slot unions, and
elevated capsule supply checks now call `evaluateAutomaticUsePiecePool` through
`evaluatePlannerAutomaticUsePool`. The adapter preserves each resolved slot's weather, activity,
register override, and owner-exclusion occasion, while making the three-piece hot-weather
outerwear limit an explicit capacity policy. Plan ranking, workbench caps, capsule quotas, roster
selection, and recombination remain strategy owned by `outfitSetPlanner.js`; suppressed diagnostics
read `underlyingExcludedPieces` so typed findings are not lost. The only production caller of the
legacy whole-filter adapter now sits in recovery logic in `rules.js`.

**Fifth-consumer migration, 2026-08-24:** `repairWholeWardrobeOutfit` now obtains its
required-footwear substitution pool from the same automatic-use evaluator mechanics. To avoid a
`rules.js` ↔ `eligibility.js` import cycle, `evaluateAutomaticUsePiecePoolCore` owns the
dependency-neutral pool iteration, owner-constraint preload, typed findings, anchor disposition,
and capacity policy; the public `evaluateAutomaticUsePiecePool` supplies the canonical piece
verdict. Recovery supplies that same verdict locally and keeps its existing required-footwear and
shoe-relevance strategy. This completed the runtime-consumer migration named by Slice 2; visual
presentation policy and post-composition validation remain deliberately separate later slices.

**Retirement, 2026-08-25:** Slice 7 removed the executable
`filterWholeWardrobePiecesForGeneration` compatibility projection. Tests and tracked diagnostics
now call `evaluateAutomaticUsePiecePool` and name its canonical `eligiblePieces` and
`underlyingExcludedPieces` projections directly. The retired symbol remains only in a source
tombstone and ratchet assertions, not as an importable API.

### Slice 3 — structured outfit validation

Replace parallel booleans and prose diagnoses with one typed finding pipeline. Compose core
structure, ownership, eligibility, dependency, and optional slot/set validators. Preserve selected,
advisor, freeform, and capsule behavior by mapping the shared findings through distinct disposition
policies. Keep a temporary boolean compatibility adapter only while callers migrate, then remove it
when every caller consumes the structured result.

**Required proof:** identical outfits produce identical findings across flows; only the reviewed
disposition may differ.

**First foundation migration, 2026-08-24:** `evaluateOutfitStructure` now emits ordered typed
category-core findings with stable codes, messages, and count evidence. A temporary boolean adapter
and `describeOutfitStructureGap` projected its results while callers migrated; the two prior
independent category-count implementations are gone. Existing callers, message wording, top-over-
dress allowance, shoe requirement option, and disposition remain unchanged. Role cardinality,
layer/base mechanics, ownership/context findings, slot rules, set rules, and concept-board policy
remain specialized and are not silently folded into this narrow core.

**Second consumer migration, 2026-08-24:** `locallyGateWholeWardrobeOutfits` and
`validateSubmittedPlanOutfits` now consume `evaluateOutfitStructure` directly. Whole-wardrobe keeps
its established coarse rejection projection (`not a complete wardrobe outfit`) and both gate and
advisor modes still reject structural errors before later disposition policy. Submitted plans keep
the shared primary message previously supplied by `describeOutfitStructureGap`, then continue into
their dependency, winter-indoor, slot, register, repetition, and set validators only as before.
No acceptance rule or model-call sequence changed. The boolean compatibility adapter remains for
route filters and other callers awaiting bounded migration.

**Third consumer migration, 2026-08-24:** route-level selected and whole visual composition now
consume `evaluateOutfitStructure` directly. Selected-piece resolution keeps its existing valid-only
filter. Whole visual composition evaluates each normalized model outfit once and reuses that result
for diagnostic rejection logging, visual-critic eligibility, saved-variant layered-formula counts,
and final model-output filtering. The former route-local category recount is replaced by a stable
finding-code → existing diagnostic-message projection, preserving strings such as
`structural: missing shoes` and `structural: dress plus bottom`. No critic, fallback, saved-Main, or
response disposition changed. Freeform role validation remains intentionally richer.

**Compatibility retirement, 2026-08-24:** after the third migration left no production consumers,
the temporary boolean adapter was deleted. Contract tests and the tracked cross-flow diagnostic now
assert `evaluateOutfitStructure(...).valid` directly, and an architecture ratchet prevents the
export from returning. `describeOutfitStructureGap` remains because it is a deliberate human-
message projection with active plan/capsule consumers.

**Explicit-role migration, 2026-08-24:** the freeform tool module's prose-only role validator was
replaced by `evaluateOutfitRoles` in `outfitValidation.js`. The owner now emits typed findings for
invalid/multiple roles, footwear and primary-core absence, dress/primary conflicts, orphan layers,
role/category mismatch, and standalone tops mislabeled as layers. `propose_outfit`, slot swaps,
contract tests, and the tracked cross-flow diagnostic consume that result directly. Existing
finding order, public messages, broken-card visibility, retry behavior, and dress-plus-layer roles
are unchanged; the unused `missingGaps` validator argument was removed because it never decided a
finding. An architecture ratchet prevents the former tool-local validator and category helper from
returning. Pair mechanics, layer direction/sight, plan slot/set checks, and disposition composition
remain later Slice 3 work.

**Dependent-fact migration, 2026-08-24:** `pieceRequiresBaseLayer` in `attributes.js` now owns the
structured question “does this garment require a base beneath it?” Only normalized explicit `yes`
returns true; unset and explicit `no` remain false, preserving the field's additive default.
Capsule capacity/validation/guidance, protagonist ordering, selected local-fallback ordering,
renderer instructions, and freeform primary-top/dress swap filtering all consume that reader. The
capsule-local fact reader and direct runtime equality checks were removed, with a ratchet preventing
their return. A ranking A/B comparison against the recorded audit baseline reported zero changed
scenarios. At that migration boundary, the different independent-coverage and pair-mechanics
contracts remained unresolved; the following migration records their later resolution.

**Required-base contract migration, 2026-08-24:** owner review resolved the overloaded term: the
existing card fact “Needs a base layer” means required coverage for a dependent garment, while
ordinary layering uses inner garment / outer layer and does not inherit a close-fit rule.
`evaluateBaseLayerCandidate` now emits `compatible | incompatible | unknown` with typed findings
from structured `needs_base`, opacity, and `fit_on_body`; `evaluateRequiredBaseLayers` composes the
same verdict across category-only plan outfits and explicit freeform roles. Capsule capacity,
postconditions, and supply attribution retain unknown candidates but no longer count known loose
fits as bases. Submitted plans and `propose_outfit` require sight of both garments when legacy fit
or opacity is missing, then leave visual success to the model; known incompatible candidates reject
even after sight. Slot swaps consume the same hard findings. Tests distinguish this from a draped
blouse under ordinary outerwear, which remains outside the contract. The exact cross-flow baseline
is unchanged because its dependency fixture has no candidate base; new fixtures cover known close,
known loose, sheer, dependent, missing metadata, sight-backed unknown, and the ordinary-layer no-op.

**Layer-direction contract migration, 2026-08-24:** `evaluateLayerDirections` now owns the distinct
ordinary-layer question “which piece sits over or under which?” across submitted plans, freeform
proposals, and direction-participating slot swaps. Explicit overlay, underlayer, dependency, role,
and outerwear facts produce a known direction. Missing legacy direction data produces `unknown`,
not a taste-coded rejection: both garments must be visually seen, then the stylist model may make a
provisional one-turn judgment. That allowance is marked `provisional_visual_judgment` in typed
evidence and counted separately as `proposeVisualLayerDirectionAllows`; it writes no garment fact
and can be removed at the shared disposition point if live decisions are poor. The former
`pieceReadsAsStandaloneBaseTop` tee/tank keyword veto was retired. Known construction
incompatibilities remain governed separately by `evaluateRequiredBaseLayers` and cannot be
overridden by sight.

**Composed-verdict and disposition migration, implemented 2026-08-25:**
`evaluateWearableOutfit` now composes the narrow structure/role, required-base, and optional
layer-direction verdicts into one result with `hardFindings`, advisory findings, unresolved sight
pairs, and evidence. Whole and selected visual composition, the whole local gate, freeform
proposal/correction/slot swaps, plan submission, and recovery validators consume it. Hard findings
remain hard everywhere; sight can resolve only unknown visual evidence, never a known
incompatibility. Paid whole/selected model attempts that fail hard validation remain visible as
Needs review cards with the actual reason even when valid sibling cards satisfy the requested
count. Valid-card count is never obtained by weakening a finding. Concept boards intentionally
retain their lighter validation contract.

### Slice 4 — reusable candidate-set construction

Build one bounded-set implementation that accepts eligible pieces, an injected ranking strategy,
protected IDs, required structures, dependency requirements, and hard capacity. It returns selected
pieces plus an explicit coverage/cap report. Migrate selected quotas, visual global trim, plan
workbench limits, and capsule postconditions. Keep search in retrieval mode while reusing the same
eligibility and cap primitives.

**Required proof:** no hard cap silently removes the last viable structure when capacity permits;
impossible coverage is surfaced consistently.

**Shared owner and first consumer migration, 2026-08-25:** `candidateSet.js` now owns bounded
structural supply independently of taste. `completeOutfitSupplyRequirement` describes the valid
top + bottom + shoes and dress + shoes paths, including a compatible-or-unknown required coverage
base when a dependent garment participates; `buildCoveredCandidateSet` combines those requirements
with caller ranking, protected IDs, and a hard capacity. It is an exact order no-op when the
caller's original selection already covers the requirement. When it does not, it swaps in only the
minimum ranked supply needed; when the wardrobe or capacity cannot cover the requirement, it
returns `required_structure_unavailable` or `required_structure_exceeds_capacity` rather than
silently spending the slot.

Selected-piece quotas, the visual roster's category/global trim, coordinated-plan slot workbench
limits, and the capsule model bench now consume this owner. Selected anchors remain protected;
each plan slot and each capsule slot gets its own context-restricted requirement; search remains a
retrieval flow. Direct selected-piece and whole-wardrobe visual generation stop before thumbnail
preparation and the paid composer when their final gated roster has no complete path. They return
an explicit shortfall and no locally fabricated accepted outfit card. A selected `needs_base`
anchor is the bounded exception: it remains visible as an incomplete Needs review card with the
hard dependency reason when no compatible base exists. Multi-slot planning
sets an uncoverable slot's requested composition count to zero and discloses that slot while other
coverable slots continue. Existing capsule roster quotas and postconditions remain capsule policy;
the shared primitive replaces only the bench's parallel category-core admission logic.

### Slice 5 — shared recovery primitives

Implement validated `substitute`, `complete`, `fallback`, and `discloseShortfall` operations. Every
mutation immediately runs the shared validator. Migrate selected local/absolute fallback, whole
backfill/footwear repair, plan completion, capsule repair, and freeform correction paths. Cost and
retry budgets remain flow policy.

**Required proof:** no recovery path can return a result the corresponding primary validator would
reject on a hard invariant.

**Implemented 2026-08-25:** `recovery.js` now provides validator-mandatory `validatedSubstitute`,
`validatedComplete`, and `validatedFallback` operations plus `discloseRecoveryShortfall`. Selected
local and absolute fallback use anchor + category structure + required-base validation; whole local
backfill injects `locallyGateWholeWardrobeOutfits`; both footwear repair implementations validate
the exact shoe-mutated outfit; plan completion and capsule completion/substitution inject
`validateSubmittedPlanOutfits`; capsule roster palette substitution injects
`validateCapsuleRoster`; and a freeform correction that supersedes a broken proposal validates the
exact corrected card before replacement. Candidate order, one-call/no-call policies, and retry
budgets remain with their flows. Permanent unit and source-ratchet tests prove the common owner is
present at every migrated recovery boundary.

### Slice 6 — projections and response normalization

Generate model-visible invariant text from shared context/eligibility/validation results. Normalize
accepted, annotated, repairable, and rejected response shapes with provenance. Keep prompts,
composer strategies, cache boundaries, and UI-specific actions distinct.

**Implemented 2026-08-25:** `outfitValidation.js` now serializes category structure, explicit-role
structure, and typed findings for the model-visible consumers that previously restated them.
`candidateSet.js` owns the existing bounded-supply shortfall wording next to the report it
projects. `outfitResult.js` provides one versioned result envelope with exactly one disposition,
typed findings/annotations, provenance, and optional repair capability. Selected-piece,
whole-wardrobe, freeform proposal, coordinated-plan/capsule, capsule expansion, and deterministic
capsule repair cards now use it. Existing top-level `broken`, `diagnosticOnly`, `systemFlags`,
`rejectionReason`, `capsuleRepair`, source labels, and plan context remain compatibility/UI fields;
composition strategies, model-call sequences, cache boundaries, and ranking are unchanged.

### Slice 7 — final architecture ratchets

Confirm that retired gate, quota, diagnosis, fallback, and context branches were deleted in their
owning slices. Add narrow checks that active entry points import/inject the shared stages and that
retired symbols cannot return. Re-run the full cross-flow fixture corpus and ranking A/B diff. Only
after this should provider/state cleanup be considered.

**Implemented 2026-08-25:** the final audit found one retired executable surface: the legacy
whole-wardrobe filter response adapter. It has been deleted, and all tracked tests and diagnostics
now exercise the public shared eligibility owner. The cross-flow fixture is schema 5, records the
composed wearable verdict directly, and no longer records the retired eligibility response shape
as an independent stage. Source ratchets require active
entry points to call the shared context, eligibility, bounded-supply, validation, recovery, and
result-envelope owners and prevent retired context assemblers, category booleans, direct recovery
mutations, and the whole-filter export from returning. The retained
`selectCandidatesForOutfitGeneration` and `buildVisualComposerRoster` functions are internal
ranking/presentation strategies behind shared public adapters, not competing eligibility owners.

Each slice is one semantic contract, updates the matching behavioral docs in the same commit, runs
the full offline suite, and runs the ranking A/B diff whenever scoring or attribute classification
can change.

---

## 7. Ratified owner decisions

The remaining Slice 1 and Slice 3 product-policy questions were resolved on 2026-08-25:

1. **Context and state:** precedence is field-specific as recorded in Slice 1. Saved artifacts and
   persistent freeform state remain distinct named inputs with provenance; neither replaces the
   other.
2. **Eligibility:** a selected anchor may bypass automatic-use eligibility. Missing photographs or
   metadata are not global exclusions. Sparse supply may relax soft preference/ranking only; hard
   constraints and known incompatibilities remain binding.
3. **Unknown evidence:** unknown does not mean invalid. A missing fact blocks only when necessary to
   prove a hard requirement. Sight may resolve styling-quality uncertainty; otherwise the flow
   discloses the uncertainty rather than guessing.
4. **Candidate guarantees:** a wearable-outfit product preserves complete structural supply whenever
   eligible supply exists. Retrieval-only products may return partial supply with an explicit gap.
5. **Validation:** hard-invalid findings are hard everywhere. Repairable findings may enter bounded
   recovery, and the exact repaired result must pass the same hard validator. Advisory projection is
   flow policy.
6. **Recovery and visibility:** validation controls disposition, not visibility. A paid model result
   that fails hard validation remains visible as Needs review with its actual reason; mixed outcomes
   return valid and Needs review cards together. Count never weakens a hard finding.
7. **Lighter products:** concept boards intentionally retain their lighter validation and do not
   claim full wearable-outfit validity.
8. **Selected dependent anchor:** the selected `needs_base` garment remains the premise, but its hard
   dependency is not waived. Without a compatible base, preserve it as incomplete / Needs review.

These rulings close the owner-decision blockers for Slices 1 and 3. Remaining technical cleanup
notes elsewhere in the census are backlog findings, not pending product-policy decisions.

---

## 8. Post-254 architecture roadmap

The completed slices establish semantic owners; they do not erase every intentional flow adapter or
every legacy fallback. The active residual roadmap is
[post-254-architecture-roadmap.md](post-254-architecture-roadmap.md). It records, for every
remaining census shortfall:

- what is still independently implemented;
- whether the difference is intentional policy or unresolved duplication;
- risk, canonical interface, consumers, and regression ratchet; and
- whether action is allowed now, after PR 254 live validation, or only after a concrete defect.

The strongest bounded deletion candidate is the duplicate capsule-expansion capacity fallback.
The broadest monitoring concern is candidate selection, but its status is no longer Critical:
`candidateSet.js` owns structural survival under hard capacity, while ranking and product budgets
remain explicit specializations. Piece eligibility is likewise no longer Critical because all named
runtime consumers receive the shared underlying verdict; roadmap R2 guards against a future adapter
reintroducing a private hard gate.

No roadmap item authorizes a universal selector or orchestrator. Implementation after live testing
still requires the evidence gate named by that item.

---

## 9. Verification and observability inventory

### Slice 0 cross-flow baseline — implemented 2026-08-24

`scratch/capture_cross_flow_architecture.js` now runs one 14-piece synthetic wardrobe through the
active deterministic exports for context, the per-piece trust verdict and shared pool eligibility,
visual roster, selected-piece
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

The current schema-5 capture records architecture evidence rather than only the triggering layering
case:

- With a fixed August date, `current season` is hot under the heuristic while the same fixture also
  supplies a neutral profile. `resolveStylingContext` records the supplied profile as authoritative
  with provenance and separately records `calendarSeason: summer`, so physical weather and
  seasonal applicability cannot be collapsed into one caller-owned string.
- The hot-hiking scenario proves the per-piece hard gate and `evaluateAutomaticUsePiecePool`
  return the same underlying eligible IDs and findings, including the owner constraint.
- An otherwise valid shoe with missing comfort metadata is allowed by the shared trust aggregate,
  excluded by the hiking visual roster, and retained in other bounded sets according to their own
  named unknown-data policy. This is intentional adapter behavior and remains observable.
- A five-image visual cap, four-piece selected-candidate cap, six-piece capsule budget, and
  five-piece capsule bench target record what each independent truncation strategy protects or
  drops under pressure. The first capture exposed a five-image visual roster with one top, one
  bottom, and no shoes because category ceilings rounded down independently. The 2026-08-25 Slice 4
  baseline now records the intended correction: all five places are used and at least one
  top + bottom + shoes path survives. Selected and capsule paths retain their distinct ranking and
  policy mixes; only the bounded structural-supply invariant is shared.
- Missing shoes, duplicate shoes, and a dependent top without its required base now agree through
  `evaluateWearableOutfit` and every full wearable consumer at the hard-validity level. Narrow core
  and role validators still expose only their deliberately smaller question; flow messages remain
  projections of the shared findings.
- A dress-plus-top relationship is hard-valid at category level but requires visual review when its
  direction is unknown. Whole advisor policy may annotate it, explicit freeform roles may reject an
  invalid role assignment, and plan submission may require sight; the shared result records the
  unresolved pair rather than guessing.
- Selected fallback constructs a replacement direction directly; plan completion mutates the
  submitted outfit. Both inject their authoritative shared validator through `recovery.js`; their
  mutation strategies intentionally remain different.

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

The implemented suite now covers the original cross-flow corpus, typed eligibility/validation
findings, selected and plan recovery validation, bounded structural coverage, dependency/base
semantics, normalized result dispositions, and the deleted-symbol ratchets. Slices 0–7 are complete;
the residual risks are sequenced in §8 and do not permit a caller to reintroduce a private semantic
implementation.

No paid model, vision, or image call is part of this deterministic architecture corpus.
