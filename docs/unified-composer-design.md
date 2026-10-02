# Unified composer design (draft, revision 3, 2026-09-14)

**Status:** active — research framework for owner review. Not an implementation decision; nothing here is approved or implemented.

- **Revision 2** replaced the proposed orchestration default with an experiment, made the equivalence contract the goal, and brought endpoint calibration and backfill into scope.
- **Revision 3** made the shared styling evidence and judging stages the invariant, with card count and orchestration as declared, measured differences. It turned calibration into a cause-classification audit with no presumed tolerance rule, and kept trip-wide packing and rotation outside per-card equivalence.

## 0 · Goal: the equivalence contract

**The same intent, conditions, garments and garment facts must produce the same styling judgment, whichever chat path received the request.** "Show me an outfit for tomorrow" in `/ask`, the Whole Wardrobe button, and a trip slot for the same day are one styling question. They may differ in how the request is phrased, how many cards are wanted and how cards are presented. They may not differ in what the stylist is shown or which rules judge its answer.

Sharing a one-card composer is not enough to meet this. If `/ask`, Whole Wardrobe and trip still supply different rosters, different fact lines, different photographs, different weather wording, or different gate, repair and critic stages, the styling logic still depends on how the question was formulated. The end state eliminates every such difference, or records it as a deliberate, owner-ratified exception.

**What is invariant, and what is a declared difference.** A full request cannot be identical across a one-card path and a multi-card path: the schema, card-count wording and token cap differ by construction, and §2 deliberately keeps a one-N-card-call arm. So the contract does not compare whole requests.

- **Invariant: the shared styling evidence.** Across paths it must be identical:
  - the resolved context (occasion, activity, location, date, both weather endpoints, anchor garment);
  - the roster and its order;
  - each garment's fact line;
  - the photographs, with detail and media type;
  - the weather statement;
  - the styling and wearability guidance text.
- **Invariant: the judging stages.** Every card, from any path, passes through the same gate, weather evaluation, repair eligibility and critic inputs, with the same evidence.
- **Declared, measured differences:**
  - card count and the count wording;
  - the output schema's card array;
  - the token cap scaled to count;
  - orchestration (one N-card call or N one-card calls, and any directions or avoid-lists).

  These are named fields, not an open allowlist, and their quality effect is measured by §2 rather than assumed to be neutral.
- **Outside per-card equivalence: trip-wide constraints.** Packing-list limits, cross-day rotation, repeat allowances and set-level coverage (for example, a layer packed elsewhere in the roster) are plan-level decisions owned by the planner. They may change which card a trip slot gets. They are recorded as trip-plan inputs and judged at the plan level, not counted as per-card divergence. The per-card contract applies once those constraints are stated as inputs to the card.

The contract is measurable in two layers.

- **Styling-evidence equivalence (offline, no provider calls).**
  - Fix a frozen snapshot and one resolved intent, and route it through every entry point.
  - Extract the invariant components from each request, using the sealed identity already built for Stage 2 split into evidence fields and declared count and orchestration fields.
  - Pass condition: the evidence fields are byte-identical, the judging stages receive the same inputs, and the declared fields differ only where the path's count or orchestration differs.
  - Any other difference must appear in a named allowlist with an owner ruling. An unlisted difference fails the test.
- **Judgment equivalence (small, pre-registered, paid, owner-rated).**
  - Compared at equal card count and orchestration, so the only remaining variable is the entry path. With identical evidence, residual differences are model sampling, not formulation.
  - A small check confirms owner ratings do not differ by entry path beyond replicate-to-replicate variation on the same path.
  - This runs once at the end of migration, not per step.

**Divergence census first.** Before any code moves, an offline census enumerates every component that differs between entry points for the same resolved intent:
- how the roster is chosen (model-chosen search categories versus the deterministic roster);
- which garment facts are rendered, and where (catalog row, `view_pieces` truth line, composer line);
- which photographs are sent, in what order and at what detail;
- how weather is stated;
- which gate, backfill, repair and critic stages run, and with what inputs.

Stage 1 already found several of these. The census makes the list complete and becomes the checklist the migration closes. Each item is closed by removing the difference or by an owner-ratified allowlist entry.

**Evidence this design rests on.**
- **Stage 1** (`docs/stage1-cause-matrix-2026-09-14.md`): the one-outfit tool loop and the Whole Wardrobe bundle differ in too many components at once to crown either one. Their failures are component-level: payload omissions, unsurfaced unknowns, model-chosen search categories dropping dresses, silent endpoint tolerance, and a critic blind to weather.
- **Stage 2** (§10a and `scratch/ab_stage2_runs/2026-09-14/review/results/`), small samples, descriptive only:
  - **A:** a metadata-representation-confounded result.
  - **B:** the complete fact line showed no consistent per-card effect.
  - **C:** asking one call for five cards never raised per-card quality above a one-card call, and lowered it in 4 of 5 pairs; best-of-set quality was equal. C compared one five-card call with one one-card call. **It did not test five parallel one-card calls**, with or without avoid-lists, so it cannot choose an orchestration.
  - **S3 (72/62):** cards with a removable layer were worn 12 of 14 times, cards without one 0 of 18. That is a strong hypothesis, not a rule.
- **Operations:** composer calls of about 100k input tokens took 15–106 s; 2 of 33 exceeded the 120 s route timeout.

**Out of scope.**
- No sleeve taxonomy field and no construction rule. The sleeve-geometry verdict stays log-only; see the 2026-09-14 amendment in `docs/engine-behaviour-map.md`.
- No categorical weather rule such as "every 72/62 outfit needs a layer".
- Unknown-construction surfacing is a separate follow-up (§8).

## 1 · One canonical composition primitive

Every stylist-chat formulation reduces to one primitive: **compose one card for one resolved context from one supplied roster.**

- **Inputs.**
  - Resolved context: occasion, activity, environment, the two weather endpoints, location, date, and any anchor garment.
  - The candidate roster, from one production supply stage shared by every entry point: eligibility, suppression, ranking, category caps and order.
  - The shared garment-evidence payload (§3), and photographs chosen by one documented policy.
  - Optional orchestration inputs (§2), only if the comparison adopts them.
- **Output.** One card in the atomic slot schema: `base_top_id`, `bottom_id`, `dress_id`, `middle_layer_id`, `outer_layer_id`, `shoes_id`, with `label`, `reason`, `styling_instructions`, `watchFor`, plus a `wear_plan` (§4). No role vocabulary.
- **Shared by** the Whole Wardrobe route, the selected-piece composer, saved-outfit variants, the `/ask` `single_outfit` and `bounded_multi` profiles, and trip/capsule slot cards. Under §0, each entry point may differ only in how it resolves the intent and how many cards it asks for. It may not differ in roster, facts, photographs or judging stages.
- **Roster question (open).** The one-outfit loop lets the model choose search categories and view 8–12 photographs; the bundle shows about 83 photographed candidates from a deterministic roster. Whichever is chosen is chosen once, for every path.
  - **Recommendation:** the deterministic production roster. Model-chosen categories silently dropped whole categories in Stage 1.
  - A narrowed photographed workbench is an experiment arm, not an assumption.

## 2 · Multiple options: an experiment, not a default

No orchestration default is proposed. C shows only that one N-card call does not raise per-card quality. Whether N separate one-card calls do better is untested, and so is whether their diversity inputs help or hurt.

**Pre-registered comparison, on one frozen roster and the same intents:**

| Arm | Orchestration |
|---|---|
| O1 | One N-card call (today's behaviour) |
| O2 | N independent one-card calls, identical requests, no diversity inputs |
| O3 | N one-card calls, each with a preassigned direction from the existing mission/archetype vocabulary |
| O4 | N one-card calls with preassigned directions **and** avoid-lists (pieces or formulas reserved by other options) |

- O2 isolates "one card per call" from any steering. O3 and O4 separate the effect of a direction from the effect of forbidding pieces. Avoid-lists constrain the stylist and could lower per-card quality, so they must earn their place.
- **Outcomes:**
  - per-card owner-rating means (primary);
  - an equal-card comparison;
  - best-of-set and at-least-one-wearable, reported separately;
  - duplicate and near-duplicate rate (identical slot sets);
  - latency and cost.
- If the budget allows only two arms, run O1 against O2 first; directions and avoid-lists are a second, conditional comparison.
- Whatever wins, duplicates are reported. They are never silently refilled by a different mechanism.

## 3 · One shared garment-evidence payload

- **One builder for every flow.** The garment line is the production composer line followed by the appended structured facts (the B1 superset, `composerExperimentGarmentLine(piece, 'complete')` in `routes/ai.js`).
  - Nothing is dropped or reinterpreted.
  - Unknowns are stated, not hidden by a sparse convention.
  - No role vocabulary.

  **Audit criterion before B1 becomes canonical: more complete is not necessarily more truthful.** Every whole-garment field in the line (for example fabric weight, silhouette, fit, stretch, warmth level) is checked for whether it invites an unsupported part-specific inference. In Stage 2 A, the model read 238's garment-level `weight: medium` as evidence about its sleeves (§10a of the cause matrix). Per field, the outcome is one of:
  - keep as is;
  - keep, with its scope stated (whole garment, not sleeve or lining);
  - omit from the model line.

  The criterion does not hold up the framework or the census. It gates only the step that makes the line canonical (M1).

  The one-outfit catalog row and the `view_pieces` truth line converge on the same builder. This is required by §0, not merely tidy. Contract B did not show a per-card benefit; the superset is adopted for equivalence and evidence completeness, not as a proven quality lever.
- **Model-facing guidance is evidence-shaped.** It carries raw facts and neutral statements, never engine verdict words: no "acceptable", "recommended", "ordered for these conditions", or categorical sleeve rule.
- **Photographs: one documented policy (open decision).** Production model paths send the worn photo first, while the Stylist Chat card shows the hanger photo first. Choose deliberately, ideally after a small hanger-versus-worn comparison. Until then, keep worn-first on every path and record the image actually sent.

## 4 · Weather: endpoint and configuration evidence, audited in this arc

The real question is: **can the outfit be worn in realistic configurations across both endpoints?** Weather understanding is central to this arc, so the endpoint audit is part of the design, not a deferred follow-up.

- **Before composition.**
  - State both endpoints in the garment warmth vocabulary: the cold-end and warm-end target levels.
  - Every garment line already carries its warmth level.
  - Add one neutral statement: an outfit can change between endpoints by putting on or taking off removable layers, and the model should say which configuration it intends at each end.

  No instruction requires a layer.
- **In the output.** `wear_plan` states, per endpoint, which slots are worn: for example, cold end all slots, warm end `outer_layer_id` off. The model's own sentence of intent goes in `styling_instructions`.
- **After composition.**
  - The endpoint evaluator computes the completed level and the signed distance to each endpoint target, both for the model's declared configurations and for the lightest realistic configuration. It also records whether the declared warm-end configuration exists.
  - These are recorded as raw evidence on the card and in debug, identically for every entry point (§0).
  - Whether any of it is fed back to the model in a bounded second turn is an open, measurable choice. It would be raw numbers only, never verdict words.
- **Endpoint audit (in scope, before any weather evidence gates, ranks or is fed back).**
  - The evaluator today tolerates one level at both endpoints, silently. That tolerance is unexamined.
  - **Owner weather ratings cannot by themselves establish a tolerance.** A low rating may come from missing or wrong garment tags, a thin trouser, the shoes, exposure (wind, sun, shade, transit), or construction. None of those is an error in ordinal endpoint distance.
  - **Offline, no provider calls. For every owner-rated Stage 1 and Stage 2 card, with its snapshot and conditions:**
    1. Compute the evaluator's evidence: the completed level and signed endpoint distance for each realistic configuration, and the declared warm-end configuration.
    2. Classify the likely causes of every weather-related rating disagreement. A disagreement may carry **several causes**, or be marked **undetermined**; neither is forced into a single category. Candidate causes: a garment-fact gap or error (with the affected field), a lower-body or footwear contribution, exposure or activity, construction, configuration (a layer that couldn't realistically come off), or ordinal distance itself.
    3. Record metadata confidence per card: which relevant fields were tagged, owner-corrected, or unknown.
  - **Only then ask whether any endpoint tolerance is supported,** and only on the cards whose disagreement is attributed to ordinal distance with adequate metadata confidence. Cards where distance is one of several causes, or which are undetermined, are reported but not used to set a tolerance.
  - **Acceptable outcomes include:**
    - no change;
    - a finding that the facts can't support a decision;
    - a garment-fact or tagger fix;
    - an exposure or lower-body evidence gap;
    - a tolerance change.

    A new ±level rule is not presumed. Any change needs its own owner ruling.
  - The S3 cards are the first set. Their small sample is stated, not smoothed over. If the attributed set is too thin, a small pre-registered, owner-rated weather set is proposed separately for approval.
- **Audit status (2026-09-14, exploratory).**
  - **Provenance:** all verdicts below are **current-branch evaluator reruns on frozen snapshots**, not the verdicts the original Stage 1 and Stage 2 runs delivered.
  - **Triage:** weather ≤3 = inadequate is a triage assumption, not owner truth.
  - **Step 1, extraction.** `scratch/endpoint_audit_extract.mjs` covered 126 rated cards and listed 26 for coding. Output is gitignored under `scratch/endpoint_audit_runs/2026-09-14/`.
  - **Step 2, flat-day replay — a diagnosis, not a proposed fix** (`scratch/endpoint_flatday_replay.mjs`). The replay reproduced 126/126 recorded verdicts first. `evaluateEndpointFit` drops the as-composed state at the warm end whenever a layer is removable.
    - **With coat-on eligible at the warm end:** 7 of 39 cards at 46°F walking change from substantial shortfall to fits. That is six appropriate cards plus a sleeveless-base card the owner rated inadequate, which then passes because nothing represents base coverage under a coat.
    - **Controls:** no verdict changes at 65/50 or 72/62.
  - **Step 3, diagnosis of owner-established outcomes** (`exploratory-coding-v3.md`, `scratch/endpoint_mechanism_compare.mjs`, `scratch/endpoint_warmth_decompose.mjs`).
    - **Dress 996791, too hot at 72°F.** Its warmth score (medium substance + long sleeve) equals tops the owner found comfortable at 72°F, and the same ±1 warm-end tolerance admitted those. The facts that do differ (one-piece sheath, close fit, rib knit, stretch) are not warmth inputs. Diagnosis: a representation gap. Ordinal distance is involved but not the discriminator.
    - **Cardigan 131, not warm enough as the only layer at 50°F.** Its score (medium + cashmere high-loft credit + long sleeve) credits it at or above fleece layers that worked through the same layer step-up. Front closure or open wear, neckline and knit permeability are not inputs, and the schema has no closure field. It works as a light layer at 72/62 and under coats. Diagnosis: a representation gap in open-front knit layer credit, compounded by the step-up, and by the tolerance on light bases.
    - **Undetermined:** which specific unrepresented property decides either case; the sleeveless card's exact objection; and the turtleneck + olive jacket looks, which have no notes.
    - **Owner questions:** none are prerequisites.
    - **Scope:** no rule about dresses, wool, knits or cardigans follows from these findings.
- **Request inspection and next experiment (2026-09-15).** The diagnosed cards had both endpoints, photographs and stronger alternatives. What was missing was any statement of wear, and of the coverage left, at each end of the day. A neutral explanation instruction was piloted as an experiment-only change (`docs/day-wear-explanation-experiment-2026-09-15.md`). The 12-call pilot showed no useful signal: day-wear cards were rated worse, and half of their plans rationalized the garment choice. Nothing is carried; the raw choices are investigated before any further prompt change.
- **Hypothesis handling.** S3's removable-layer pattern is a pre-registered outcome in the endpoint audit and orchestration evaluations: does a declared warm-end configuration predict owner ratings? It is not encoded as a gate.

## 5 · Latency, timeout and cost

- **Observed.** A single composer call with about 100k input tokens (about 90k image tokens) took 15–106 s. Two of 33 timed out at 120 s. One timed-out call still completed on the provider side, and was probably billed, because the route timeout does not cancel the provider request.
- **Per-call budget.**
  - A declared timeout per primitive call.
  - The provider request actually aborted on timeout (abort signal), so an abandoned call is not left running.
  - The timeout recorded as a typed technical outcome.
  - No silent automatic retry. At most one explicit, logged retry, and only where a user is waiting.
- **Per-request budget for N options.** It depends on the §2 result.
  - **Parallel one-card arms:** wall-clock is bounded by the slowest call. Partial results can be delivered as they complete, and a failed call is disclosed as an unavailable option, not padded.
  - **One N-card call:** a timeout loses every card at once.
- **Cost.**
  - **One card:** about $0.033 uncached, or $0.007 with Stage-1-like caching, at about 100k input.
  - **N one-card calls:** up to N× input. The identical roster prefix should cache across calls; measure before assuming.
- **Size levers, measured before use:** roster image cap, image detail policy, narrowed workbench (§1).

## 6 · Migration of existing entry points

Each step is its own change:
- flag-gated, default off;
- the §0 request-equivalence test extended to the paths the step touches;
- request-diff tests against production;
- the required ranking A/B;
- an offline preflight.

Paid, owner-rated evaluations run only where a step changes what the model sees or does: §2, a §4 weather set if the audit needs one, and final judgment equivalence.

| Step | Change | Entry points |
|---|---|---|
| M0 | Divergence census (§0) and the request-equivalence harness, with the current differences as a failing baseline | all |
| M1 | Shared garment-evidence builder, photo policy and weather statement behind a flag | all composer and loop payloads |
| M2 | Endpoint audit, offline: cause classification and metadata confidence first, tolerance question second (§4) | evaluator |
| M3 | Canonical single-card primitive, built from the Whole Wardrobe composer internals (limit 1) | Whole Wardrobe route with limit 1 |
| M4 | Orchestration comparison (§2); the chosen orchestration is implemented only after the result | Whole Wardrobe route, `/ask` `bounded_multi` (`generate_outfits`), saved-outfit variants |
| M5 | `/ask` `single_outfit` calls the primitive on the shared roster; the router is unchanged | freeform one-outfit chat |
| M6 | Selected-piece composer as primitive plus anchor constraint | selected-piece outfits |
| M7 | Trip/capsule slot cards call the primitive per card. Trip-wide packing, rotation and set-level coverage stay in the planner as declared plan inputs, outside per-card equivalence (§0). Any cross-slot inputs follow the §2 result. | `plan_outfit_set`, capsule composition |
| M8 | Downstream stages unified across paths (below), then final judgment equivalence | all |

**Downstream stages (M8).** The goal is that every path runs the same stages with the same inputs, not that a stage survives because its output tests well.
- **Gate and weather evaluation:** shared, deterministic judges of the model's card. They run identically on every path.
- **Local backfill:** a disclosed last resort, never a stylist. It runs only when the composer returns fewer valid cards than requested. Every backfilled card is labelled as engine-assembled on the card and in debug, counted separately in every evaluation, and never presented or scored as stylist output. It is not tuned toward owner ratings. A path with no backfill discloses the shortfall instead, and the behaviour is the same on every path.
- **Repair:** limited to its existing, evidence-bounded screen, with the same eligibility on every path.
- **Critic:** receives the same conditions and evidence as the composer, so it is not blind to weather (Stage 1). Whether it stays at all is decided by the §0 contract and owner ratings of its effect, recorded as a ruling.

## 7 · Open decisions for the owner

1. Roster source: deterministic production roster, or a narrowed photographed workbench (§1).
2. Photo policy: worn-first or hanger-first (§3).
3. Any allowlisted differences between entry points beyond the declared count and orchestration fields (§0), one ruling each.
4. Orchestration arms and budget for the §2 comparison.
5. Whether raw configuration evidence is fed back in a bounded second turn (§4), after the endpoint audit.
6. Timeout, retry and partial-result behaviour for user-facing requests (§5).

## 8 · Recorded follow-ups (outside this design)

- **Unknown-construction surfacing.** Construction unknowns are shadow-only today and never shown. Decide separately whether and how to surface them, without reopening construction logic in this arc.
- **Metadata To-Do coverage audit and orphan-task bug** (separate task).
- **144 stretch retag** (pending owner).
