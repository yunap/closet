# System-aware weather roster for one-outfit discovery

**Status:** Historical diagnosis and recovery record. Ratified 2026-09-07; first implementation
completed offline 2026-09-08; its deterministic path-selection architecture was removed from the
`single_outfit` runtime on 2026-09-09. The corrective model-owned catalog slice is implemented.

**Recovery implementation, 2026-09-09:** `buildSystemAwareWeatherRoster` and its one-outfit call
site were removed. Search now returns the complete hard-eligible wardrobe as a sparse,
identity-ordered `stylist_catalog`, with zero code-selected systems and zero automatically attached
photographs. The model authors 2–3 complete candidate directions whose union contains at most twelve
IDs for visual inspection, may use one additional targeted view of up to four IDs after a concrete
photographic finding, and owns composition; shared deterministic
validation still accepts or rejects the final proposal. The response reports hard exclusions by
their actual gate reasons. The copied live fixture now measures 208 eligible garments, 42,646 catalog
characters (down 12,063 from the old compact index), and no selected paths. Sections describing the
path frontier below remain as incident history, not current architecture. The provider-free,
source-database-safe measurement is `scratch/diagnose_single_outfit_catalog.mjs`.

**Model-comparison follow-up, 2026-09-09:** complete catalog access removed code-owned aesthetic
selection, but `thread_1788939301104` showed the model anchoring on its first plausible complete set
and viewing no alternative. The recovery therefore adds an observable model-owned deliberation
step rather than restoring a roster: the model submits 2–3 complete candidate directions in its
first `view_pieces` call. Code verifies their identity, structure, distinct heroes/piece sets, layer
presence, known hard wearability facts, and aggregate image budget. It never generates or ranks a
candidate direction, and
the final model may recombine all viewed pieces. The viewed truth line now repeats the sparse catalog
projection so the model does not lose the facts it used to nominate a garment.

**Pre-photo validity follow-up, 2026-09-09:** `thread_1788985997110` showed the model spending its
first visual call on two directions whose `warm:moderate` outerwear already failed the certain
60→48°F breezy range, then trying a third moderate jacket. Candidate direction authorship remains
entirely model-owned, but `view_pieces` now reuses the final shared hard-fact validator before loading
images. A known-invalid direction is returned for model repair, spends no visual budget, and is never
replaced or ranked by code. Separately, the route's hard activity enum now requires affirmative
structured UI state or affirmative request evidence so a model-invented `walking` value cannot
silently narrow footwear. The copied
208-piece catalog measures 42,646 characters after representing known everyday formality once in
the sparse conventions and emitting missing formality explicitly.

**Selection-ownership and catalog correction, 2026-09-08:** Live run
`thread_1788898396668` showed that the first implementation reduced a large feasible-system space
to four photographed paths before the model could make an aesthetic choice. Calling those paths
"mechanically feasible starting points" did not change their practical
authority: they were almost the only garments the model could see, while one additional
`view_pieces` call was too narrow to restore wardrobe-scale choice. This violates the established
ownership boundary. Code may enforce eligibility, construction, weather physics, image budgets,
and final proposal validity; it may not preselect the four outfits from which the stylist is
expected to choose. The model must choose the visual shortlist from a complete, decision-useful
catalog of eligible garments, and code must validate the resulting system.

The same run measured the 208-row `eligible_piece_index` at 54,709 serialized characters. It was
not rich wardrobe description: repeated keys and low-information defaults dominated it
(`insulating_layer` was `unknown` on 197 pieces, `weather_protection` was empty on 198,
`needs_base` was false on 203, and 165 of 170 emitted construction degrees were zero). A
default-aware sparse encoding preserves the current mechanical information at roughly 36,674
characters, but compression alone is not the goal. The catalog must spend its budget on facts that
let the model make a styling shortlist—structured colour/pattern, silhouette/fit, formality,
visual read, and the relevant physical facts—without asking it to infer those properties from a
garment name. Exact field projection and tool interaction are part of the corrective implementation
and must be measured against this captured 208-piece fixture.

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

The original decision was that the weather-aware one-outfit roster must be constructed from
**complete mechanically feasible outfit paths**, not by independently sampling garment categories or
preserving one garment from each warmth label. The 2026-09-09 recovery supersedes that decision:
code no longer chooses a one-outfit roster at all; it supplies complete eligible facts and validates
the model's final choice.

For this flow, a path is one complete candidate system:

- `primary_top + primary_bottom + shoes`, or `dress + shoes`;
- every structurally required base piece;
- an actual outerwear piece when the request requires one;
- any other layer necessary for the system to meet the wearing-window contract.

The path is not a proposed outfit and carries no aesthetic endorsement. It establishes only that the
pieces can form a structurally complete system with no known hard physical failure under the resolved
context. The model still judges colour, pattern, proportion, silhouette, register, emotional
coherence, and whether the pieces look good together.

The first implementation returned two linked evidence tiers:

1. a complete compact index of every hard-eligible piece in the requested categories; and
2. a bounded visual working set formed as the union of several complete feasible paths selected by
   deterministic construction/thermal coverage.

That second tier is superseded as a styling-choice mechanism. The corrected flow keeps complete
hard eligibility and feasibility facts, then lets the model nominate the garments or systems worth
photographing from the complete catalog. An image ceiling may bound that model-nominated visual
inspection, and final validation may reject a nominated combination for a known physical failure,
but a code-selected coverage sample must not masquerade as the user's wardrobe choice set.

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
- **Model-nominated visual working set:** the bounded set of eligible pieces the model asks to inspect
  after reading the complete catalog.
- **Catalog-only eligible piece:** an eligible identity not yet photographed in this turn. It remains
  available for model nomination and can never be described as a wardrobe gap.

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

The removed 2026-09-08 implementation did not materialize the naive Cartesian product. A deterministic structured-
coverage frontier per role retains representatives only while they add a new physical facet from
§7; it has no fixed per-category fill target. Double-layer permutations receive the same treatment
with role-prefixed middle/outermost facets plus the shared construction verdict and warmth-pair
facets, so they stop when no new construction relationship is represented.
`buildSystemAwareWeatherRoster` joined
and validates complete systems from those
adaptive representatives. The complete hard-eligible identity set remained in
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
- Surface whether paths are adequate at both endpoints as factual feasibility evidence.
- Preserve overshooting identities in the complete catalog; a winter coat can be useful boundary
  evidence, but code does not force it into the model's visual shortlist.
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

## 7 · Model-owned visual shortlist

The complete eligible catalog is the model's discovery surface. Deterministic path construction may
calculate feasibility, expose factual incompatibilities, and support gap diagnosis, but it does not
choose the four systems the stylist sees. In particular, construction-diversity coverage is useful
diagnostic evidence, not an aesthetic proxy and not a shortlist owner.

The corrected interaction must preserve these invariants:

1. the model can distinguish every eligible identity using useful structured styling and physical
   facts before choosing what to inspect;
2. the model nominates a bounded visual shortlist rather than receiving a finished code-selected
   outfit shortlist;
3. the image budget is stated to the model and enforced atomically by code;
4. nominated pieces remain subject to the same shared eligibility and construction owners;
5. the composed outfit always passes through ordinary `propose_outfit` validation;
6. rejection returns a specific repair fact and does not silently substitute a code-preferred
   outfit; and
7. an unpictured eligible identity remains a real wardrobe option, never a wardrobe gap.

The tool-contract revision may use a model-nominated piece set or model-nominated system set. That
choice must be settled with a captured prompt-size and interaction-count comparison before coding;
it must not reintroduce deterministic aesthetic ranking under a new name. The old four-path selector
may remain temporarily as internal diagnostic coverage, but its output cannot be framed as the
stylist's practical choice set.

### 7.1 · Sparse, decision-useful eligible catalog

The catalog declares default semantics once and emits per-piece exceptions rather than repeating
`unknown`, `false`, empty arrays, derived removability, and other low-information values. Sparse
encoding must be losslessly reconstructable for every mechanical fact the current index carries;
missing evidence must remain distinguishable from a known zero wherever that distinction matters.

The recovered budget is spent on existing structured facts that help the model decide which pieces
deserve photographs. The projection must cover, where applicable: identity and category;
colour/pattern facts; silhouette, fit, length and sleeve construction; formality and `reads_as`;
thermal, insulation, opacity/base requirements, protection, and footwear support. Free text must be
bounded and sourced from its canonical field. Garment names are identity labels, not a fallback
classifier for missing style facts.

The tracked diagnostic reports total serialized characters, characters by field, default-value
frequency, missing-value frequency, and category contribution for the fixed 208-piece fixture. A
smaller payload is not accepted if it removes model decision information; a richer payload is not
accepted merely because it adds prose.

## 8 · Tool response contract

`search_wardrobe` remains the model's one batched discovery call. Under `single_outfit`, its response
adds an explicit evidence block alongside the ordinary rows:

```json
{
  "eligible_piece_catalog": {
    "defaults": { "needs_base": false, "weather_protection": [] },
    "pieces": [
      { "id": 12, "name": "...", "category": "top", "thermal": "...", "formality": "..." }
    ]
  },
  "feasibility_report": {
    "eligible_piece_count": 120,
    "known_feasible_path_count": 42,
    "unknown_path_count": 17
  }
}
```

The example fixes semantics, not the final wire shape. The corrective implementation must specify
the model-nominated visual-inspection request and response after measuring the competing interaction
contracts. The normal user-facing answer never exposes IDs, enum labels, thermal distance, or
selection machinery.

Logical identity-permutation counts, evaluated-frontier counts, enumeration scope/completeness,
hard-failure distributions, and selection reasons stay in internal diagnostics. They are not useful
styling evidence and must not enlarge or distract the model-facing `feasibility_report`.

The sparse catalog contains every eligible piece with the mechanical and styling facts defined in
§7.1. Visually inspected rows retain the current richer truth shape.

The single-outfit prompt tells the model:

- the complete catalog, not a code-selected path sample, is the wardrobe choice surface;
- nominate the most promising bounded visual shortlist using catalog facts, then judge the returned
  photographs;
- if it recombines pieces across paths, `propose_outfit` will validate the new system normally;
- a wardrobe-gap claim must come from complete hard eligibility/feasibility, never from the visual
  subset or a capped prefix.

No unavailable tool or trip/packing instruction enters this response.

## 9 · Observability

Add a debug payload for every system-aware roster:

- resolved context identity and provenance;
- eligible counts by category;
- candidate, known-feasible, unknown, and hard-failed path counts;
- hard-failure counts by canonical finding code;
- legacy diagnostic path IDs and piece IDs while the first-pass selector remains;
- thermal dispositions for those diagnostic paths;
- construction signatures covered by those diagnostic paths;
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

1. **Complete recall:** every hard-eligible piece appears in the complete catalog; unpictured pieces
   remain available for model nomination.
2. **Atomic paths:** every advertised `system_path` is structurally complete, and every one of its
   photographed pieces is present. No image cap produces a partial advertised path.
3. **Cold-range choice:** a 60→48°F required-layer fixture with an uninsulated warm jacket, an
   insulated warm wool coat, and a very-warm filled winter coat exposes multiple feasible outerwear
   choices; one warmth label cannot collapse them to one representative.
4. **Both worn states:** a warm coat over a light base is not known-feasible when removing the coat
   leaves a known warm-end undershoot; a compatible remaining layered system is feasible.
5. **Overshoot is not erasure:** an otherwise valid winter-coat identity remains in the complete
   catalog as boundary evidence, but code cannot force it into or let it crowd the model-nominated
   visual shortlist.
6. **Hot-system choice:** a hot-weather fixture preserves multiple complete adequate systems for
   validation and every eligible identity for model nomination; early heavy database rows cannot
   become a hidden shortlist.
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
18. **Model-owned shortlist:** when more than four mechanically feasible systems exist, no
    deterministic four-system sample is presented as the model's practical outfit choice set. The
    captured tool trace shows the model nominating bounded visual inspection from the complete
    eligible catalog.
19. **Sparse mechanical equivalence:** reconstructing declared defaults and per-piece exceptions
    yields exactly the same mechanical facts as the current 208-row index, including the distinction
    between missing construction evidence and a known zero degree.
20. **Styling decision coverage:** two eligible garments that differ in available structured
    colour/pattern, silhouette/fit, formality, or visual-read facts remain distinguishable before
    photographs are requested; the catalog does not require name inference to recover those facts.
21. **Measured payload:** the provider-free diagnostic records the 54,709-character current
    baseline, the candidate replacement's total and per-field contribution, and the number of
    eligible identities represented. Payload reduction may not be obtained by dropping identities
    or required decision facts.

### Real-wardrobe provider-free diagnostic

Add a tracked diagnostic that runs the canonical Vienna context against a copied/test database and
prints:

- all eligible outerwear grouped by thermal and construction evidence;
- every outerwear identity retained in the adaptive construction frontier;
- logical identity-permutation and evaluated structural-frontier counts;
- the legacy four-path diagnostic sample and its reasons while that diagnostic remains;
- the complete indexed alternatives; and
- image-budget consumption by category;
- compact-catalog characters by field and category, including default and missing frequencies; and
- the model-nominated visual shortlist in captured/offline tool-contract fixtures.

The diagnostic must not call a model or mutate the live database. Its assertions must not name a
production garment ID. The report may show real fixture names for owner inspection.

### Live acceptance

After offline tests and a provider-cost preview, repeat one cold-range and one hot-weather request.
For each capture verify:

- one batched discovery call;
- the model, not deterministic coverage code, nominated the bounded visual shortlist from the
  complete eligible catalog;
- no arbitrary category prefix, one-per-warmth collapse, or four-system aesthetic bottleneck;
- the final outfit was chosen from model-requested visual evidence;
- no hidden trip, packing, or unavailable-tool instructions;
- one accepted proposal without a blind rediscovery search; and
- the final styling result is reviewed separately from mechanical feasibility.

## 13 · Corrective implementation sequence

The first offline implementation remains in history. The owner correction proceeds with:

1. Freeze the 208-piece, 54,709-character capture as the payload-measurement fixture and add the
    per-field/default-frequency diagnostic.
2. Specify and compare model-nominated piece-set versus system-set visual inspection, including
    interaction count, prompt size, image atomicity, and repair behavior.
3. Replace the wide repeated-row index with the losslessly reconstructable sparse catalog and add
    structured styling decision facts.
4. Remove the four deterministic paths from model-facing shortlist authority; retain construction
    frontier/path feasibility only as validation and internal diagnostics where useful.
5. Update the isolated prompt/tool projection and permanent ownership regressions.
6. Amend `engine-behaviour-map.md`, `freeform-rearchitecture-handoff.md`,
   `search-propose-signal-inventory.md`, and `flows/freeform-stylist-chat.md` in the same implementation
   commit.
7. Run the ranking A/B harness if any shared gate, score, or contextual ordering changes; explain
   every diff.
8. Run the full offline suite, the tracked provider-free diagnostic, then the two cost-previewed live
    checks.

The work is complete when the model can choose what to inspect from every eligible wardrobe identity
using useful structured facts, receives enough visual evidence to style the final system, and passes
that choice through shared physical validation—without code choosing four outfits on its behalf and
without a finite image budget pretending an unseen wardrobe option does not exist.
