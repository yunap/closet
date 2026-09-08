# System-aware weather roster for one-outfit discovery

**Status:** Ratified 2026-09-07; implemented offline 2026-09-08. Cold and hot live acceptance remain.

**Role-chain correction, 2026-09-08:** The first implementation's fixed construction-frontier
ceilings (`12` tops, `12` bottoms, `6` shoes, `24` outerwear) turned maximums into fill targets and
made required-layer search outerwear-led. A role frontier must stop when structured coverage is
exhausted instead of filling an arbitrary quota. An outerwear-category garment may serve either as
a middle layer (`layer_top`) or the outermost removable layer (`outerwear`) in a particular system.
Required-range construction therefore admits `base → middle → outermost` chains, validates both
adjacent sleeve relationships through the shared layer-pair owner, and removes only the outermost
piece for the warm state. A light cardigan is neither globally excluded nor allowed to compete with
a coat for the same job: it enters when a compatible complete chain gives it a real middle-layer job.
Known thermal evidence also fixes the role order: a warmer garment cannot be placed underneath a
known lighter outermost garment. Unknown ordering evidence remains eligible for visual judgment.

**Scope:** the `single_outfit` execution profile's `search_wardrobe` evidence roster. This document
does not redesign trip packing rosters, capsules, `generate_outfits`, or the final outfit validator.

**Related authority:** [single-outfit weather-layer vertical slice](single-outfit-weather-layer-vertical-slice-spec.md),
[thermal comfort band](thermal-comfort-band-spec.md),
[search visual budget](search-wardrobe-visual-budget-spec.md),
[search/propose signal inventory](search-propose-signal-inventory.md), and
[freeform prompt ownership](freeform-prompt-ownership.md).

## 1 · Decision

The weather-aware one-outfit roster must be constructed from **complete mechanically feasible outfit
paths**, not by independently sampling garment categories or preserving one garment from each warmth
label.

For this flow, a path is one complete candidate system:

- `primary_top + primary_bottom + shoes`, or `dress + shoes`;
- every structurally required base piece;
- an actual outerwear piece when the request requires one;
- any other layer necessary for the system to meet the wearing-window contract.

The path is not a proposed outfit and carries no aesthetic endorsement. It establishes only that the
pieces can form a structurally complete system with no known hard physical failure under the resolved
context. The model still judges colour, pattern, proportion, silhouette, register, emotional
coherence, and whether the pieces look good together.

The tool returns two linked evidence tiers:

1. a complete compact index of every hard-eligible piece in the requested categories; and
2. a bounded visual working set formed as the union of several complete feasible paths.

An image ceiling may reduce the number of paths. It must never truncate individual pieces from an
otherwise advertised path, and it must never erase a hard-eligible piece from the compact index.

## 2 · Why the current roster is not a styling choice

Live run `thread_1788846530795` used the intended compact flow and accepted its first card, but the
outerwear roster gave the model no proportionate choice for a stated 60→48°F breezy gallery evening.
The photographed candidates were dominated by light/moderate cardigans, plus an uninsulated leather
jacket and a down-lined winter coat. A warm black wool coat existed in the hard-eligible wardrobe but
was absent from both the returned ten-piece truth roster and the six-piece visual roster.

The immediate cause was `capSingleOutfitSearchResults`: it protected the first result from each
`garmentWarmthLevel`, then filled remaining slots in retrieval order. This ensured label coverage but
not decision coverage. One `warm` piece cannot represent all warm construction: an uninsulated
wind-resistant leather jacket, an insulated wool coat, and a filled technical coat ask materially
different questions even when the ordinal warmth classifier places two of them together.

The deeper cause is ordering the operation incorrectly:

```text
current:  independently cap categories → attach a few images → ask the model to invent a system
target:   establish feasible systems → select several whole systems → attach their images
```

Increasing the cap, adding more construction buckets, or preserving more warmth labels changes the
sample but retains the same category-first defect.

## 3 · Definitions

These terms refine, rather than replace, [CONTEXT.md](CONTEXT.md):

- **Eligible piece index:** every piece surviving active-status, owner/request exclusion,
  occasion/activity prohibition, and other existing hard piece gates for this search.
- **Candidate path:** a complete structural combination assembled from eligible pieces before
  physical validation.
- **Feasible path:** a candidate path with no known error-severity finding from the shared structural
  and environmental contracts. Unknown evidence remains unknown and is not a failure.
- **Thermal disposition:** the shared comparison result at each relevant wearing state—adequate,
  undershoot, overshoot, or unknown. This is evidence-selection metadata, not a style score.
- **Visual working set:** the deduplicated union of pieces belonging to the selected feasible paths.
- **Fallback index:** the compact rows for eligible pieces not in the visual working set. These pieces
  remain available for a targeted `view_pieces` call and can never be described as a wardrobe gap.

This document uses “roster” only for the task-specific working set. The full wardrobe is not a
roster, and an arbitrary capped prefix is not a curated roster.

## 4 · Ownership and reuse

The implementation must assemble the new roster from existing owners rather than creating parallel
weather or outfit rules:

- `resolveToolStylingContext` owns the resolved occasion, activity, environment, date, and canonical
  weather identity.
- `wholeWardrobePieceTrustDecision` and the existing request/occasion/activity exclusions own
  piece-level hard eligibility.
- `ROLE_CATEGORY_EXPECTATIONS` and the shared outfit-role validators own structural slots.
- `evaluateRequiredBaseLayers`, `evaluateLayerDirections`, and the shared layer-construction verdict
  own dependent garments and physical over/under compatibility.
- `garmentWarmthLevel`, `outfitThermalContribution`, `outfitRangeCoverage`,
  `requiredThermalEndpointBands`, and `compareThermalFit` own thermal facts and comparison.
- `evaluateWearableOutfit` remains the final proposal authority. The roster must reuse its component
  verdicts or a side-effect-free projection of them; it must not copy their thresholds or messages.
- the model owns all aesthetic judgment.

If path construction needs a reusable primitive, add it beside `buildCoveredCandidateSet` in
`candidateSet.js`; do not embed a second outfit validator in `tools.js`. The `executeTool`
orchestrator in `tools.js` may call the primitive and serialize its result.

The same canonical resolved context must reach eligibility, path feasibility, evidence selection,
and final `propose_outfit` validation. A path builder may not resolve weather or activity again.

## 5 · Path construction

### 5.1 Start from the complete hard-eligible pool

Apply existing hard piece gates before path construction. Preserve every survivor in the compact
index, including pieces with no photograph and pieces with incomplete thermal data. Unknown is never
converted to failure, zero warmth, or an unfavorable sort value.

Soft `ruleFit` tiers may remain visible, but only `prohibited` may remove a piece under the existing
compose-mode contract. Retrieval order, database ID, and garment name carry no weather authority.

### 5.2 Enumerate structural cores

Construct the two canonical core families:

- each eligible dress with each eligible shoe;
- each eligible primary top with each eligible primary bottom and each eligible shoe.

Add a required compatible base before a dependent/sheer piece can become a complete core. A piece
with `needs_base` is evaluated as the system it actually requires; its standalone warmth must never
represent the worn outfit.

Shoes remain part of each advertised complete path, and the shared piece-level activity and weather-
protection gates run before this builder. Because no current outfit-level stage reads a shoe against
another garment, clothing construction is evaluated once and the selected structural systems are
projected across the adaptive shoe frontier. This must be retired if a relational shoe/outfit
contract is added. Accessories are optional and do not participate in feasibility; the model may
add one from the compact index after choosing the structural system.

Implementation does not materialize the naive Cartesian product. A deterministic structured-
coverage frontier per role retains representatives only while they add a new physical facet from
§7; it has no fixed per-category fill target. Double-layer permutations receive the same treatment
with role-prefixed middle/outermost facets plus the shared construction verdict and warmth-pair
facets, so they stop when no new construction relationship is represented.
`buildSystemAwareWeatherRoster` joins
and validates complete systems from those
adaptive representatives. The complete hard-eligible identity set remains in
`eligible_piece_index`, and the report distinguishes the logical identity-permutation count from
the actually evaluated structural-frontier count.

### 5.3 Add removable configurations

When `layer_requirement:'required'`, every path must contain an eligible outerwear-category piece
assigned the outermost `outerwear` role. A second eligible outerwear-category piece may be assigned
`layer_top` as a middle layer. For each core/layer chain:

- evaluate the full path at the cold endpoint;
- validate base→middle and middle→outermost construction in their actual direction;
- remove exactly the outermost removable piece;
- evaluate everything remaining at the warm endpoint;
- retain the configuration only when it has no known hard structural/environmental failure.

This consumes `outfitRangeCoverage`; it does not create a second “coat plus base” calculation.
The middle layer remains in the warm state. A known sleeve conflict with the selected outermost
layer invalidates that chain, while missing sleeve evidence remains unknown and available for visual
judgment. Light layers are not globally filtered by warmth or garment kind. A known warmer-middle /
lighter-outermost ordering is rejected as a reversed role chain; unknown thermal evidence is not.

When `layer_requirement:'unspecified'`, construct both unlayered and legitimately layered paths when
the resolved conditions support them. The system must not force outerwear merely because weather is
present.

### 5.4 Classify rather than collapse uncertainty

Each feasible path records:

- structural verdict and finding codes;
- cold-end thermal disposition when applicable;
- warm-end thermal disposition for the remaining configuration when applicable;
- IDs of required/removable pieces;
- whether incomplete evidence could change either conclusion;
- existing activity/footwear and protection findings.

Known hard failures do not enter the primary feasible set. Unknown paths remain eligible in a
separate `unknown` class and may supply the working set when known-feasible choices are insufficient.
The response must say that photographs or metadata are needed; it must not present uncertainty as an
honest wardrobe gap.

## 6 · Symmetric temperature behavior

One algorithm serves heat, mild weather, and cold. There is no `if cold then choose coats` branch and
no garment-name rule.

### Variable cool/cold exposure

- The complete layered system is compared with the cold endpoint.
- The actual remaining system is compared with the warm endpoint.
- Prefer paths adequate at both endpoints for the primary visual set.
- Preserve a limited overshooting path as a visible upper boundary when one exists; a winter coat is
  useful evidence, but not the only alternative.
- A known undershooting path cannot occupy a primary slot under the explicit required-layer contract.

### Hot exposure

- Evaluate every piece actually worn, including a required base beneath sheer/open clothing.
- Prefer paths whose complete thermal contribution is adequate for the hot endpoint.
- Preserve coverage diversity: long and airy may coexist with short and bare. Code must not infer
  breathability, cooling, or heat safety from hem/sleeve length, material name, or visual appearance.
- Existing extreme-heat hard gates retain their authority. Ordinary thermal overshoot remains the
  shared advisory classification; roster ordering may use the disposition to prioritize evidence,
  but must not silently turn that advisory into permanent ineligibility.
- A visually light garment requiring another layer is represented by the combined path, preventing
  its standalone label from understating the worn system.

### Weather absent or unresolved

The system-aware weather ordering is a provable no-op. Construct structural paths using existing
eligibility, preserve stable retrieval order, and add no inferred temperature or season verdict.

## 7 · Selecting paths for the visual working set

The target is **four complete feasible paths** for a one-outfit request, or every feasible path when
fewer than four exist. Four is a visual evidence target, not a promise of four aesthetically good
outfits.

Selection is lexicographic and observable:

1. known-feasible before evidence-unknown;
2. thermal adequacy at every required wearing state before advisory overshoot;
3. smallest advisory thermal distance before larger distance;
4. maximize new factual construction coverage across the already-selected paths;
5. stable original retrieval order as the final tie-breaker.

The construction-coverage signature may use only structured physical fields already owned by the
garment model: warmth level, insulating-layer presence, interior construction, fabric category and
weight, removability, weather protection, sleeve coverage/shape, hem coverage, opacity,
`needs_base`, shoe coverage, and walk support. It must not use colour, print, style lane, garment
name, style notes, `do_not_pair_rules`, or a learned aesthetic score.

Selection operates on atomic paths. Before adding a path, calculate the photographs its previously
unseen pieces would consume. If adding it would exceed the existing call-level or per-category image
ceilings, skip that whole path and consider the next one. Never add half the path and still advertise
it as visually available.

Shared pieces are deduplicated, so four paths may fit comfortably when they reuse a shoe or base. The
selector may prefer a path that adds fewer redundant photographs only after feasibility and thermal
disposition; image thrift cannot outrank physical correctness.

If no complete path fits the configured visual budget, return a specific configuration error rather
than a partial system. That is a policy/configuration failure, not a wardrobe gap.

## 8 · Tool response contract

`search_wardrobe` remains the model's one batched discovery call. Under `single_outfit`, its response
adds an explicit evidence block alongside the ordinary rows:

```json
{
  "system_paths": [
    {
      "path_id": "stable-turn-local-id",
      "piece_ids": [12, 34, 56, 78],
      "wearing_states": {
        "cold": { "piece_ids": [12, 34, 56, 78], "thermal": "adequate" },
        "warm": { "removed_piece_id": 78, "piece_ids": [12, 34, 56], "thermal": "adequate" }
      },
      "evidence_state": "known | unknown"
    }
  ],
  "visual_piece_ids": [12, 34, 56, 78],
  "eligible_piece_index": [
    { "id": 12, "name": "...", "category": "top", "thermal": "...", "needs_base": false }
  ],
  "selection_report": {
    "eligible_piece_count": 120,
    "known_feasible_path_count": 42,
    "unknown_path_count": 17,
    "visually_presented_path_count": 4,
    "omitted_feasible_path_count": 38
  }
}
```

The exact JSON nesting may follow the existing array-plus-retrieval convention, but all semantic
fields above are required. The normal user-facing answer never exposes IDs, enum labels, thermal
distance, or selection machinery.

Logical identity-permutation counts, evaluated-frontier counts, enumeration scope/completeness,
hard-failure distributions, and selection reasons stay in internal diagnostics. They are not useful
styling evidence and must not enlarge or distract the model-facing `selection_report`.

The compact index contains every eligible piece with enough facts to decide whether requesting its
photo could matter: identity, category, thermal fact line, insulation/derived construction thermal
degree/removability, coverage, opacity/`needs_base`, weather protection, and footwear support where
applicable. Primary
visual rows retain the current richer truth shape.

The single-outfit prompt tells the model:

- the paths establish physical feasibility only, not aesthetic approval;
- inspect the photographs and choose among them visually;
- it may call `view_pieces` once for compact-index alternatives whose evidence could improve the
  outfit;
- if it recombines pieces across paths, `propose_outfit` will validate the new system normally;
- a wardrobe-gap claim must come from the exhaustive path result, never from the visual subset or a
  capped prefix.

No unavailable tool or trip/packing instruction enters this response.

## 9 · Observability

Add a debug payload for every system-aware roster:

- resolved context identity and provenance;
- eligible counts by category;
- candidate, known-feasible, unknown, and hard-failed path counts;
- hard-failure counts by canonical finding code;
- selected path IDs and piece IDs;
- thermal dispositions for selected paths;
- construction signatures newly covered by each selected path;
- paths skipped because an atomic path would exceed the visual budget;
- compact-index IDs omitted from photographs;
- whether a final proposal used a supplied path, recombined supplied pieces, or introduced a
  targeted `view_pieces` alternative.

Every selection step must have a human-readable reason string. These diagnostics remain internal;
the model receives only the compact selection report and factual path states needed to do its job.

## 10 · Honest gaps

The tool may report a wardrobe structural gap only when the complete hard-eligible index itself shows
that a required role has no supply. It may report a known physical shortfall only after the adaptive
structural frontier is completely evaluated. Omitted identity permutations are interchangeable only
for the structured facts consumed by these gates; all identities remain in the compact index for
visual differentiation. Unknown gate evidence still produces an evidence shortfall and a targeted-
inspection opportunity; it is never upgraded to a wardrobe gap.

Distinguish these outcomes:

- **known physical shortfall:** candidates exist, but every path has the same known hard failure;
- **evidence shortfall:** a potentially valid path exists but required facts are unknown;
- **visual-budget/configuration failure:** feasible paths exist but none can be supplied atomically
  under the configured image budget;
- **wardrobe structural gap:** no eligible complete path exists at all.

Only the last is a wardrobe gap. A capped or unpictured answer may never masquerade as one.

## 11 · Deliberate non-goals

- No deterministic aesthetic ranking or finished outfit recommendation.
- No garment-specific IDs, names, or owner wardrobe facts in production logic.
- No revival of `outerwear_role`.
- No inference that wool is insulated, linen is breathable, dark colours are hotter, or a garment is
  comfortable from appearance alone.
- No new thermal scale, temperature threshold, activity credit, or weather resolver.
- No automated purchase recommendation when the wardrobe lacks a path.
- No change to trip/capsule roster selection or shared packed-layer presentation.
- No attempt to solve regional body exposure inside roster selection. The accepted Vienna card's
  bare lower legs exposed a separate final-validation gap. This roster will inherit whatever the
  canonical validator knows; it must not hide a new leg/ankle rule inside candidate ordering.
- No UI redesign.

## 12 · Acceptance contract

### Deterministic fixtures

1. **Complete recall:** every hard-eligible piece appears either in the visual working set or compact
   fallback index; unpictured pieces remain indexed.
2. **Atomic paths:** every advertised `system_path` is structurally complete, and every one of its
   photographed pieces is present. No image cap produces a partial advertised path.
3. **Cold-range choice:** a 60→48°F required-layer fixture with an uninsulated warm jacket, an
   insulated warm wool coat, and a very-warm filled winter coat exposes multiple feasible outerwear
   choices; one warmth label cannot collapse them to one representative.
4. **Both worn states:** a warm coat over a light base is not known-feasible when removing the coat
   leaves a known warm-end undershoot; a compatible remaining layered system is feasible.
5. **Overshoot is not erasure:** an otherwise valid winter-coat path remains in the compact index and
   may appear as a boundary path, but it cannot crowd every adequate path out of the primary visual
   set.
6. **Hot-system choice:** a hot-weather fixture exposes multiple complete adequate systems instead
   of one representative per warmth label; early heavy database rows cannot consume their slots.
7. **Required-base accounting:** a very-light sheer top requiring an opaque base is classified from
   the combined worn system. It cannot outrank a standalone hot-weather path using only its own
   garment warmth.
8. **Coverage neutrality:** both a long airy garment and a shorter garment remain eligible when the
   shared thermal/heat contracts accept them; the selector contains no short-equals-cool rule.
9. **Unknown preservation:** incomplete insulation or fabric evidence produces an unknown path and a
   targeted-inspection opportunity, never a hard rejection or invented zero-warmth value.
10. **Weather no-op:** with no resolved numeric/qualitative weather, path selection adds no thermal
    reorder relative to the structural stable order.
11. **Same-context ownership:** roster feasibility and `propose_outfit` final validation receive the
    same canonical occasion, activity, environment, date, and weather provenance.
12. **Final revalidation:** a model-selected supplied path and a cross-path recombination both pass
    through ordinary `propose_outfit`; roster membership never bypasses final validation.
13. **Gap truthfulness:** known physical, unknown-evidence, visual-budget, and structural-gap fixtures
    return four distinct outcomes.
14. **Isolation:** non-`single_outfit` searches, context-free searches, trips, capsules, selected-
    piece flows, and bounded 2–5 outfit generation have no output diff.
15. **Optimized-enumerator coverage:** every distinct gate-relevant facet survives in each role it
    can serve, while identity-only Cartesian permutations do not multiply the evaluated frontier;
    completing that structural frontier reports `path_enumeration_complete:true` and names its
    scope.
16. **Role-qualified light layers:** a cardigan that fits beneath a jacket may remain in the warm
    wearing state; the same cardigan paired beneath a jacket with a known directional sleeve
    conflict is not a feasible path. Neither result removes the cardigan from the eligible index.
17. **Adaptive frontier:** mechanically duplicate pieces do not fill an arbitrary category target,
    and required-layer selection is not keyed or deduplicated around outerwear identity.

### Real-wardrobe provider-free diagnostic

Add a tracked diagnostic that runs the canonical Vienna context against a copied/test database and
prints:

- all eligible outerwear grouped by thermal and construction evidence;
- every outerwear identity retained in the adaptive construction frontier;
- logical identity-permutation and evaluated structural-frontier counts;
- the four selected visual paths and the reason each was selected;
- the complete indexed alternatives; and
- image-budget consumption by category.

The diagnostic must not call a model or mutate the live database. Its assertions must not name a
production garment ID. The report may show real fixture names for owner inspection.

### Live acceptance

After offline tests and a provider-cost preview, repeat one cold-range and one hot-weather request.
For each capture verify:

- one batched discovery call;
- at least three materially viable visual systems when the wardrobe supplies them;
- no arbitrary category prefix or one-per-warmth collapse;
- the final outfit was chosen from visually available pieces or one explicit targeted view;
- no hidden trip, packing, or unavailable-tool instructions;
- one accepted proposal without a blind rediscovery search; and
- the final styling result is reviewed separately from mechanical feasibility.

## 13 · Implementation sequence

1. Freeze the current failing cold fixture and add the symmetric hot fixture.
2. Extract a side-effect-free path-feasibility projection from the shared validation owners.
3. Implement exhaustive fixture enumeration and the production bounded construction-frontier join.
4. Add atomic path selection and construction-diversity diagnostics.
5. Replace `capSingleOutfitSearchResults` and the independent outerwear image spread on only the
   `single_outfit` route.
6. Add the complete compact index and the system-path response block.
7. Update the isolated prompt projection and prompt-equivalence fixture.
8. Amend `engine-behaviour-map.md`, `freeform-rearchitecture-handoff.md`,
   `search-propose-signal-inventory.md`, and `flows/freeform-stylist-chat.md` in the same implementation
   commit.
9. Run the ranking A/B harness if any shared gate, score, or contextual ordering changes; explain
   every diff.
10. Run the full offline suite, the tracked provider-free diagnostic, then the two cost-previewed live
    checks.

The work is complete when the model receives multiple physically credible whole-system choices for
both hot and cold conditions, without code choosing which one looks best and without a finite image
budget pretending an unseen wardrobe option does not exist.
