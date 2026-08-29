# Post-254 architecture roadmap

**Status:** Active — records residual architecture work after PR 254; no item below reopens
Slices 0–7 or authorizes a speculative shared pipeline.

**Source:** Remaining findings in
[architecture-responsibility-census.md](architecture-responsibility-census.md), reconciled against
the completed Slice 0–7 runtime and ratchets on 2026-08-25.

## Architectural end-state

Closet's target is a set of **deep semantic modules**, not one mega-pipeline. Context resolution,
automatic-use eligibility, bounded structural coverage, wearable validation, recovery, and result
normalization each have a small shared interface. Selected-piece, whole-wardrobe, freeform, plan,
and capsule flows remain separate orchestrators and supply explicit policy to those modules.

The end-state is reached when:

1. every semantic question has one canonical module and one interface used by callers and tests;
2. flow differences are named adapters or specializations with observable policy, never private
   copies of a canonical verdict;
3. candidate ranking remains objective-specific, while every outfit-producing hard cap preserves
   the shared structural-supply guarantee;
4. retrieval remains allowed to return partial supply, but reports the gap and never claims it
   produced a wearable roster;
5. every mutation is validated through the same hard contract before acceptance;
6. compatibility aliases and legacy fallbacks have named removal conditions rather than becoming
   permanent accidental interfaces; and
7. architecture tests exercise shared interfaces. Tests do not bless caller-specific copies.

This end-state deliberately does **not** require one universal ranking, one candidate selector, one
provider path, one state object, or one orchestrator. Those would enlarge the interface without
adding leverage and would fail the deletion test: deleting them would remove only pass-through
code, while the real flow policies would still exist.

## Sequencing rule

- **Now** means documentation or a no-behavior-change ratchet that protects already-completed PR
  254 ownership.
- **After PR 254 live validation** means first collect live evidence from the migrated flows, then
  perform a bounded comparison or deletion. It is not authorization to redesign behavior.
- **Concrete-defect only** means the current difference is intentional or too hypothetical to earn
  a new seam. Open implementation work only when a reproducible failure shows the present interface
  is inadequate.

## Residual roadmap

| ID | Remaining shortfall | What is still independent | Intentional policy or duplication? | Risk if left as-is | Intended canonical/shared contract | Active consumers eventually affected | Ratchet / test | Sequence |
|---|---|---|---|---|---|---|---|---|
| R1 | Piece-text fallback has two semantic blobs | `attributePieceTextBlob` in `attributes.js` and `pieceTextBlob` in `rules.js` assemble different text inputs; many rule predicates and scores still consume the latter | **Unresolved architectural duplication.** The input difference has not been fixture-compared, so deletion is not yet authorized | A field can be interpreted differently by attribute readers and rule/scoring callers; a text fix can reach only one path; broad text inputs can revive false matches | The existing ownership chain: field/schema → `attributes.js` reader → domain verdict → projection. If `pieceTextBlob` proves projection-only, rename it as such; otherwise migrate semantic reads behind attribute readers | Rule predicates and scores in `rules.js`, two uses in `core.js`/`routes/ai.js`, and tracked measurement scripts | Add a fixture comparison over structured, missing, notes-heavy, and learned-rule pieces; require every difference to be classified. Existing text-matching ratchet must not increase. Any semantic migration also runs the ranking A/B diff | **After PR 254 live validation.** Compare first; migrate/delete only from evidence or a concrete classifier defect |
| R2 | Eligibility policy can drift around the canonical verdict | Visual presentation, retrieval broadening, selected Anchor Piece bypass, capsule/plan capacity policy, and post-composition validation remain flow-local adapters around `evaluateAutomaticUsePiecePool` | **Intentional flow policy today, not unresolved eligibility duplication.** The pre-254 “Critical” wording was stale after the fifth migration and Slice 7 retirement | A future caller could put a hard weather/register/activity/owner rule into an adapter and recreate a second hard gate | `wholeWardrobePieceTrustDecision` owns the per-piece automatic-use meaning; `evaluateAutomaticUsePiecePool` owns its pool projection. Adapters may alter effective disposition only through named, observable policy and may not erase underlying findings | Selected ranking, whole visual generation, freeform search/propose/swaps/bounded generation, plan/capsule workbenches, recovery pools | Keep the source ratchet requiring these consumers to call the shared pool owner; cross-flow fixtures assert identical underlying findings while allowing different effective disposition. Any new outfit-producing entry point must be added to the consumer ratchet | **Now: guard only.** Reopen implementation only if live evidence shows an adapter answering the underlying eligibility question differently |
| R3 | Candidate selection remains distributed across objective-specific selectors | Selected category quotas, visual photo/category caps, freeform result/image budgets, capsule roster/bench/rotation, plan workbench caps, and fallback ordering remain separate | **Mostly intentional flow policy.** `candidateSet.js` already owns the shared structural-supply invariant. Search is intentionally retrieval-only. The residual duplication is local fallback selection that still chooses leading candidates without first using the shared coverage builder | Policy can be mistaken for duplicate architecture; conversely, a new hard cap or fallback can starve a required category or dependency before composition | `buildCoveredCandidateSet` + `completeOutfitSupplyRequirement` own only protected IDs, dependency-aware structural coverage, hard capacity, and explicit shortfall. Ranking, diversity, photo budgets, recombination, and retrieval budgets stay behind named flow adapters | Shared contract: selected candidate adapter, visual roster, plan workbench, capsule model bench, direct selected/whole preflight. Deferred comparison: selected and whole local fallback selectors. Explicit non-consumer: retrieval-only `search_wardrobe` | `candidate_set.test.js` proves cap/coverage behavior; cross-flow capacity-pressure fixtures prove selected/visual/plan/capsule preservation; source ratchets require outfit-producing caps to call the shared builder. Add a fallback parity fixture before any fallback migration | **Now:** correct status and protect the existing seam. **After live validation:** compare local fallbacks. Migrate them only if parity is a no-op or a live starvation defect appears. Never build a universal selector |
| R4 | Unknown evidence with unavailable sight lacks one explicit disposition contract | Required-base and ordinary-layer verdicts identify sight needs; freeform and plan adapters decide how to request sight, while missing photographs can make that request impossible | **Residual architectural policy gap**, not a duplicate fact reader | A flow can loop asking for an unavailable image, silently guess, or disclose uncertainty differently even though the underlying verdict agrees | `evaluateWearableOutfit` should expose whether unresolved sight is available as evidence; disposition policy then chooses retry, provisional visual judgment, or Needs review disclosure without changing the finding | Freeform `propose_outfit` and slot swaps, plan submission, selected/whole paid compositions when legacy metadata is incomplete | Add fixtures for unknown + both photos, one photo, and no photos across freeform and plan. Assert known incompatibility always remains hard and unavailable sight produces disclosure rather than a futile retry | **After PR 254 live validation.** Use live unknown-evidence outcomes to define the smallest result addition; do not infer a new rule now |
| R5 | Prompt projection coverage is incomplete outside structure findings | Structure/role/finding serializers are shared. The 2026-08-25 live correction centralized context applicability, but eligibility findings can still be worded or omitted independently by flow prompts | **Partly resolved potential duplication.** Context meaning now comes from `projectStylingApplicabilityContext`; flow strategy and output schema remain intentional. Redefining an eligibility fact in prose is not intentional | A prompt can still tell the model a different eligibility rule from the mechanical owner, creating paid retries or explanations that contradict validation | Context readers consume the canonical applicability projection. Eligibility/validation serializers live beside their verdict owners. Prompts choose whether to include a fact and how much budget it receives, but not its meaning | Whole and selected composers, freeform tool/controller prompts, plan/capsule workbench and expansion prompts | Applicability tests assert equivalent calendar/prose and structured-weather inputs across feedback and eligibility. Extend prompt-contract fixtures one eligibility invariant at a time when a canonical fact gains two active projections; never use prompt presence as enforcement | **After PR 254 live validation**, driven by observed prompt/validator contradiction. The observed context omission is fixed; do not sweep remaining prompts speculatively |
| R6 | Capsule expansion retained a parallel capacity fallback | Resolved 2026-08-25: `capsuleExpansionCoreCapacity` was deleted; missing legacy-card capacity now delegates to `capsuleOutfitCoreCapacity` | **Resolved duplicate/legacy fallback.** Saved planner capacity—including zero—remains preferred because allocation can bound a slot after cross-slot competition | Guard against a route-local capacity verdict returning and diverging on dependent pieces or dresses | `capsuleOutfitCoreCapacity` owns capsule capacity; expansion adapts the active saved-slot roster into that interface only when persisted capacity is absent | `/expand-capsule`, saved capsule card context, capsule planner capacity calculation | Comparison and legacy-card endpoint fixtures cover ordinary separates, missing capacity with a dependent piece, dresses, repeated slot compatibility, and persisted zero; a source ratchet forbids the deleted function | **Complete 2026-08-25** |
| R7 | Provider execution is not fully uniform | Text/vision calls mostly use `provider.js`; direct image/Responses calls and nested-call attribution remain specialized | **Intentional adapters**, with no demonstrated semantic duplication | Telemetry or cost attribution can drift, but a broad wrapper could obscure provider-specific capabilities and enlarge the interface | Keep the existing provider abstraction for shared text/vision behavior and the telemetry context for parent-turn attribution; direct image adapters remain documented | Ten provider-crossing outfit pipelines and direct image/rendering flows indexed in the flow atlas | Existing provider contract and telemetry tests; add a caller only when a new untraced provider path appears. Flow docs remain the inventory ratchet | **Concrete-defect only.** No provider consolidation roadmap item without a telemetry, cost, or correctness failure |
| R8 | State expiry and durable capsule storage are not specified | Persistent conversation state, one-turn `toolContext`, delivered cards, pending plans, and capsule card context have separate lifetimes | **Intentional distinct authorities; unresolved lifecycle design**, not current precedence duplication | Stale weather or old pending/card state can become misleading if a concrete expiry path is missing; premature consolidation would create a second generic state object | `resolveStylingContext` keeps field-specific precedence and provenance. Storage lifetimes remain separate and must be specified per field before any persistence change | Freeform continuation, bounded follow-ups, pending plan submission, capsule expansion/repair | Add time/expiry fixtures only with a ratified lifetime; keep current precedence tests proving explicit request > saved artifact > established state. Never introduce an unversioned generic state blob | **Concrete-defect only** for expiry; durable capsule persistence requires a separate owner decision |
| R9 | Result-envelope compatibility aliases remain flow-local | `broken`, `diagnosticOnly`, `systemFlags`, `rejectionReason`, source labels, plan context, and UI actions coexist with the canonical `outfitResult.js` disposition/findings/provenance envelope | **Intentional compatibility adapters**, not duplicate semantic state while the UI still reads them | A new producer may write aliases without the canonical envelope, or consumers may start treating an alias as the authority | `outfitResult.js` is the semantic result interface; aliases are projections derived from it and removable only after their last consumer migrates | Selected, whole, freeform, plan/capsule producers and card UIs | Source ratchet requires every new outfit-producing consumer to normalize through `outfitResult.js`; removal tests follow actual UI-consumer deletion, not a speculative cleanup | **Concrete-consumer only.** Remove an alias when its final reader is migrated |
| R10 | Recovery naming and strategy locality remain uneven | `repairWholeWardrobeOutfit` performs prose normalization plus a narrow footwear substitution; selected fallback, plan completion, and capsule repair have different strategy names and scopes | **Intentional strategy differences; shallow naming friction**, not a missing common recovery implementation | Maintainers may assume “repair” means structural completion and call the wrong strategy; behavior remains protected because mutations use shared recovery primitives and validation | `recovery.js` owns validated mutation mechanics; each flow keeps a narrowly named strategy describing the mutation it permits | Whole fallback/footwear repair, selected fallback, plan completion, capsule repair, freeform correction | Existing recovery tests require validation injection at every mutation. Add a rename/source ratchet only when one of these strategies is next modified | **Concrete-defect or adjacent-change only.** Do not perform a naming-only sweep now |
| R11 | Deterministic footwear-comfort repair had no owner-feedback awareness | Resolved 2026-08-28: `applyComfortFootwearRepair`'s recovery-tier substitution pool reaches the full active wardrobe, well beyond what the model was ever shown, with no mechanism to consult owner feedback about a piece introduced only there | **Resolved fallback gap, not eligibility duplication.** The primary composer path already delivers applicable accepted-synthesis lessons correctly (`getAcceptedFeedbackSynthesisMemory`); the gap was scoped entirely to the model-free repair substitution, which has no prompt for prose guidance to land in | A repair-introduced shoe could silently reinstate a piece the owner explicitly rejected for that exact context, with no review surface — `thread_1787895437637` (olive suede slip-ons, an accepted "not for summer" lesson, piece never shown to the model that turn) | `pieceIdsWithApplicableNegativeFeedback` (rules.js) is a new structured verdict primitive — reuses `acceptedSynthesisApplicabilityMatches`/`acceptedPersonalSynthesisSources`/`WRONG_PIECE_FOR_OUTFIT_FEEDBACK`, the same matching logic `getAcceptedFeedbackSynthesisMemory`/`getProvisionalWrongChoiceMemory` already use, projected as piece ids instead of prompt prose. `applyComfortFootwearRepair` takes an optional `avoidPieceIds` and excludes a flagged candidate the same hard way it already excludes a discouraged footwear type — footwear-comfort.js stays a pure decision function; only the caller reads feedback | All three selected-piece `applyComfortFootwearRepair` call sites (routes/ai.js) | `test/footwear_comfort.test.js` 2c/2d cover the primitive directly and the repair falling through to the next valid candidate when the first is flagged | **Complete 2026-08-28** |

**R5 live-validation update, 2026-08-25:** `thread_1787651275782` supplied the concrete defect R5
required: accepted summer guidance was omitted because a prompt-memory reader compared `current
season` literally while the hard-constraint path resolved it independently. The bounded correction
belongs to Slice 1's shared meaning contract: `resolveStylingContext` now exposes `calendarSeason`
and every executable season matcher shares `resolveCalendarSeason`. Prompt strategy remains local;
the meaning of season applicability does not. Cross-flow, reader, direct-guidance and freeform
prompt tests are the ratchet. R5 remains open only for a different observed canonical-fact
projection contradiction; this specific seasonal omission is resolved inside PR 254.

**R7 live-validation update, 2026-08-25:** `thread_1787687552307` supplied the concrete defect R7's
gate requires. The selected-piece visual composer (`routes/ai.js`, selected-anchor call) hit a
hardcoded `maxTokens: 2000` with 33 shown pieces and was cut off mid-JSON
(`composerUsage.outputTokens: 2000`, exactly the cap). Two independent gaps compounded it: (1)
`askClaudeWithUsage` in `provider.js` reads `response.content` and `response.usage` but never
`response.stop_reason`, so the provider's own explicit `max_tokens` finish reason is discarded
before any caller sees it; (2) this call site parses with `safeJsonFromModel` (`core.js`), whose
no-regex-match branch throws a generic `Model did not return JSON` with no truncation flag — unlike
`parseModelJson` (`provider.js`, built for this exact tagger failure mode per its spec 26 Part 7
comment), which already detects a body not ending in `}`/`]` and raises a tagged `isTruncation`
error. The result: a deterministic, cheaply-identifiable truncation was misreported as generic
model malformation and fell straight to local fallback. The whole-wardrobe "Visual wardrobe
composer" (`routes/ai.js`, ~line 2333) shared both gaps — a fixed `maxTokens: 2200` independent of
`requestedLimit`, parsed the same way. The atomic capsule composer (`routes/ai.js`, ~line 4053)
already demonstrated the fix shape in this codebase: `askStylistStructuredWithUsage` (provider-
enforced tool schema, no free-text JSON parsing) plus `maxTokens` scaled to the requested output
size, with an explicit comment on why the ceiling must track requested count. This was a
correctness defect narrowly scoped to (a) `provider.js`'s shared response handling discarding
`stop_reason`, and (b) two visual-composer call sites' fixed caps and non-truncation-aware
parsing — not a case for R7's broader provider-consolidation deferral.

**Fixed 2026-08-25.** `normalizeAiUsage` now carries a cross-provider `stopReason` (Anthropic
`stop_reason` / OpenAI `finish_reason`, normalized), threaded through `askClaudeWithUsage`,
`askStylistWithUsage`, and `askStylistStructuredWithUsage`. `parseModelJson` trusts an explicit
`stopReason: 'max_tokens'` over its string-ending heuristic and now also absorbs
`salvageFirstJson`'s narration recovery internally. `safeJsonFromModel` (`core.js`) — a shallower
duplicate of `parseModelJson` with no truncation awareness — is deleted; all ten of its former call
sites (4 in `routes/ai.js`, 6 in `core.js`) now go through `parseModelJson`. Both visual composers
now size `maxTokens` via one shared `visualComposerMaxTokensForOutfitCount(count)` instead of their
own hardcoded literals, and surface `composerErrorIsTruncation`/`composerMaxTokens` in their debug
payload. Covered by `test/parseModelJson.test.js` and `test/visualComposerMaxTokens.test.js`; full
suite green (1448 tests). **This resolves the concrete defect** — it does not close R7 itself. R7's
broader shortfall (direct image/Responses-API adapters and nested-call attribution remaining
specialized outside `provider.js`) is unchanged and intentionally untouched; R7 stays
**Concrete-defect only** as a standing gate for the next one, the same as before this fix.

**R7 follow-up, 2026-08-26 — the sibling formula this fix didn't reach.** `thread_1787717774384`
showed the same class of defect one call site over: `composeCapsulePlanOnce` (routes/ai.js), the
atomic capsule composition call, never joined the shared budget above. It carried its own
independent, under-tuned formula (`600 + count*180`, ceiling 3200) despite a heavier per-outfit
schema (`slot_id`, `piece_ids[]`, `title`, `reason`, `styling_instructions`) than the visual
composers it was modeled after. A 24-piece/10-look seasonal capsule hit that ceiling exactly
(`output_tokens: 2400`) and came back with zero outfits, surfaced to the user as a generic "engine
hiccup, please retry" — retrying would have failed identically every time. Two gaps, not one:
(a) `askStylistStructuredWithUsage`'s truncation guard only checked for a wholly-absent tool-use
`input`, not `stopReason: 'max_tokens'` on an input that parsed but was incomplete — the exact
shape a mid-generation cutoff produces on this schema-forced path, unlike the plain-JSON path
`parseModelJson` already covers; (b) three independently-hardcoded token formulas answering "how
many tokens does an N-outfit structured response need" instead of one.

Fixed by generalizing `visualComposerMaxTokensForOutfitCount` into `structuredOutfitMaxTokens(count,
{tokensPerOutfit, floor, ceiling})` (core.js) — the visual composers keep their existing numbers as
defaults; the capsule composer now passes its own honest, heavier rate and a ceiling wide enough
for its 12-look cap. `askStylistStructuredWithUsage`'s guard now also throws (with `isTruncation`
set) on `stopReason === 'max_tokens'` even when `toolUse.input` is present, mirroring
`parseModelJson`. The capsule roster-selection step (`selectCapsuleRosterViaModel`,
`outfitSetPlanner.js`) had no try/catch around its own provider calls at all — a newly-more-likely
throw there would have skipped its existing two-attempt-then-deterministic-fallback design
entirely, so both attempts are now wrapped to feed a thrown error into the same repair/fallback
path as an ordinary contract failure. `plan_outfit_set`'s composition-failure branch
(`styling-engine/tools.js`) now distinguishes a truncation from a genuine empty result, in a new
`capsule_composition_failure_code` diagnostic column (same shape as the pre-existing
`capsule_roster_failure_codes`), and no longer tells the user to retry an identical request that
would fail the same way again. Covered by `test/structuredOutfitMaxTokens.test.js` (renamed from
`test/visualComposerMaxTokens.test.js`).

**R7 follow-up #2, 2026-08-26 — the live re-test surfaced a sibling formula and a second, unrelated
bug in the same code.** `thread_1787725557304` retested the composition fix above with a real
24-piece/10-look capsule request: composition itself succeeded on the first try, confirming the
fix. But the roster-*selection* call (`capsuleRosterSelectionSchema`, routes/ai.js) — a different
call site the composition fix didn't touch — truncated twice in the same turn, both times at
exactly `output_tokens: 1860`, its formula's ceiling (`300 + budget*65`, itself a prior bump from
an even tighter 1,260-token ceiling per its own code comment). The first attempt truncated, the
built-in repair attempt truncated again, and the turn fell back to the deterministic roster —
correctly, without crashing, but after two wasted paid calls.

Per codebase-design's "one adapter is a hypothetical seam, two adapters is a real one":
`structuredOutfitMaxTokens` was generalized once more into `structuredResponseMaxTokens(itemCount,
{tokensPerItem, base, floor, ceiling})` — adding a `base` parameter, since the roster formula's
free-text reasoning (`category_shape_reason`, `category_departures[].reason`,
`repair_changes[].reason`) scales with how many categories depart from the starting shape, not
with garment count, needing a materially higher base offset than outfit generation's. The roster
call now passes its own tuned values (`{tokensPerItem: 100, base: 1500, floor: 1500, ceiling:
5500}`) instead of a fourth independent formula. Renamed again (dropping the outfit-specific name)
since a garment roster isn't an outfit — `test/structuredOutfitMaxTokens.test.js` is now
`test/structuredResponseMaxTokens.test.js`.

Separately: because the roster call truncated, the deterministic-fallback disclosure
(`[capsule fallback: I used a backup capsule selection...]`) should have reached the user — it
already flows correctly through `pendingPlan.coverageGaps` into the tool result's `plan_lines`
field, same as any other `plan_outfit_set` path — but the atomic bounded-composition success
message (`styling-engine/tools.js`) never instructed the model to present `plan_lines` at all,
unlike its two sibling non-atomic success messages ("Present these cards and the plan_lines
honestly" / "include the plan_lines"). The model silently dropped it. Not a plumbing gap — a
message-text omission that had nothing to do with either token-budget fix, found only by reading
the actual delivered answer against what the tool result contained. Fixed by adding the same
plan_lines instruction to the atomic message.

## Candidate-set reconciliation in plain terms

The remaining selectors do not justify a universal candidate module:

| Selector | Why it remains separate | Shared invariant it must consume |
|---|---|---|
| Selected quotas | Optimize support around one Anchor Piece | Protected anchor plus one complete dependency-aware outfit path under the cap |
| Visual category/global cap | Optimize a finite set of usable photographs | One complete outfit path survives when eligible photographed supply and capacity permit |
| Search result/image budgets | Retrieve evidence for an iterative model, not promise a wearable roster | Hard eligibility findings stay intact; partial retrieval reports its gap |
| Capsule roster/bench | Optimize recombination across many outfits and lifestyle slots | Every represented slot/bench preserves required structural supply or reports a shortfall |
| Plan workbench cap | Optimize one slot's model-visible working set | The slot keeps a complete eligible path or its target count becomes zero with disclosure |
| Local fallback selection | Produce reduced-ambition candidates after model failure | Every accepted fallback passes shared wearable validation; future selection migration requires parity first |

The shared module earns its keep because deleting `candidateSet.js` would redistribute structural
coverage and shortfall logic across selected, visual, plan, and capsule callers. The ranking
strategies earn their separation because deleting one would not remove its objective; it would only
hide that policy inside a generic interface.

## Do not regress

1. Do not add a hard eligibility predicate outside the canonical verdict family. An adapter may
   select, rank, disclose, or alter effective disposition; it may not rewrite underlying findings.
2. Do not add an outfit-producing hard cap without `buildCoveredCandidateSet` or an equivalent
   call to the same interface. Retrieval-only caps must say they are retrieval-only.
3. Do not create a universal ranking or candidate selector. Share facts, hard verdicts, structural
   coverage, and observability; keep objectives explicit.
4. Do not let a fallback, repair, or completion return accepted output without validating the exact
   mutation through the same hard contract as the primary path.
5. Do not convert unknown into valid or invalid inside a fact owner. Sight availability and
   visibility/retry are disposition policy and must remain observable.
6. Do not restate canonical context, eligibility, dependency, or structure meaning independently in
   a prompt once two consumers need it; serialize it beside the owner.
7. Do not introduce a second generic state object or treat saved artifacts, persistent thread
   state, ephemeral evidence, and delivered cards as interchangeable.
8. Do not add a compatibility alias without naming its canonical source and last-reader removal
   condition.
9. Do not mark a stage Critical merely because flow policies differ. Mark it Critical only when two
   active implementations answer the same semantic question or a caller can bypass a hard shared
   invariant.
10. Every new outfit-producing entry point must be added to the architecture consumer ratchet and
    the cross-flow corpus before it is considered complete.

## Review trigger

Review this roadmap after PR 254's live matrix. Move an item into implementation only when its
sequence condition is met, and record the evidence in the census. Completing live validation does
not automatically authorize every “after live validation” item: R1, R3, R4, R5, and R6 still
require their named comparison or defect evidence.
