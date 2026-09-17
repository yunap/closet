# Model-flow prompt ownership audit

**Status:** Active diagnosis — first pass 2026-09-07; no broad prompt redesign ratified.

## Why this audit exists

The architecture consolidation correctly gave shared facts and verdicts canonical runtime owners.
It did not authorize one universal model prompt. The intended chain remains:

```text
canonical fact or verdict
→ reusable projection
→ flow-specific payload
→ flow-specific model decision
```

Live capture `thread_1788814890775` proved that `/ask` could instead take this path:

```text
fresh one-outfit brief
→ client prose regex labels it correction
→ execution router skipped
→ universal full-stylist payload
```

The normalized first iteration contained a 133,349-character system prompt, 14 tools, broad saved
feedback, a 272-piece wardrobe manifest, and conflicting old/new context. The full turn used five
provider iterations, 322,901 input tokens, and 40 search images. The task itself had no prior
history. This is an execution-ownership failure, not evidence that shared semantic ownership was
wrong.

The next capture, `thread_1788817405702`, did call the execution router but still fell through to
`full_stylist` (325,707 input tokens, 40 images). Its router input exposed the deeper lifecycle bug:
the exact current request appeared both as `RECENT EXCHANGE` and `Request`. The full prompt then
called the request a correction and established only `60°`, even though the card eventually used
the correct structured Vienna 60→48°F range and walking activity. The current-question transport
copy is now removed before every prior-context consumer, not merely before final message assembly.
The response debug also retains the router's raw profile and limit separately from the execution
profile ultimately taken, so a future fallback can be attributed without reconstructing model output.

The next run, `thread_1788822538467`, did exercise `single_outfit`: a 7,142-character system,
exactly four tools, one structured current request, and no universal manifest/history/memory blocks.
That validates the profile boundary. It also found a smaller projection leak: the first
`declare_intent` result injected the universal cards contract, naming four tools that the profile had
deliberately removed. The result is now profile-specific. The same run's zero-card outcome was a
retrieval-cap failure rather than prompt overload: ten early outerwear rows hid all known warm
classes. Numeric-weather single-outfit retrieval now preserves observed warmth-class coverage
inside the same ten-row cap, leaving order and model aesthetic judgment intact.

## First-pass census

Static prompt lengths below use the current owner profile and exclude dynamic garment rows, images,
history, and memory. They are diagnostic scale indicators, not quality verdicts.

| Flow family | Prompt owner / measured base | Initial classification | Evidence / next check |
|---|---|---|---|
| `/ask` full stylist | `STYLIST_SYSTEM`, 43,596 chars before dynamic blocks | **Critical overload confirmed** | Live system reached 133,349 chars and conflicting authority. Continue decomposing by execution responsibility; do not weaken canonical validators. |
| `/ask` single outfit | `SINGLE_OUTFIT_STYLIST_SYSTEM`, 7,142 chars in the accepted capture | **Narrow boundary confirmed; one result-projection leak corrected** | Live run reached four tools with no universal blocks. `declare_intent` now returns only the reachable one-card contract; capped retrieval preserves structured warmth-class evidence. Rerun for styling quality and convergence. |
| `/ask` bounded 2–5 looks / whole wardrobe / saved variants | whole-wardrobe visual composer, 12,127 chars | Purpose-bounded; image-volume risk separate | Existing visual-budget controls apply. Inspect captures for irrelevant policy only after the single-outfit rerun. |
| Selected-piece visual styling | selected-item visual composer, 21,804 chars | **Projection overbreadth suspected** | It appends the complete occasion and activity profile JSON to the whole-wardrobe composer. Measure a live call; likely project only the resolved profiles. |
| Selected-piece text composition | outfit composer, 9,118 chars; evaluator gate, 4,711 chars | Dedicated but multi-pass | Shared validation is healthy. Check whether the second model gate still decides anything canonical code already owns. |
| Outfit evaluation / photo feedback | full evaluator, 24,496 chars plus history and three broad memory blocks | **High audit priority** | The task is specific, but payload adds whole-wardrobe feedback, global saved-board memory, and calibration memory. Determine which are exact evidence, scoped taste guidance, or unrelated baggage. |
| Outfit comparison | compare prompt, 3,515 chars | Purpose-bounded | No universal prompt. Verify only when a capture shows conflicting evidence authority. |
| Capsule roster | 7,668 chars | Dense but purpose-bounded | Complexity is inherent to finite roster selection. Keep separate roster/composition ownership. |
| Capsule composition | 4,520 chars | Purpose-bounded | Shared validators own hard meaning; model owns selection. |
| Trip roster / composition / cold-layer repair | 4,278 / 4,596 / 916 chars | Purpose-bounded | This is the healthier ownership shape: separate bounded decisions with shared facts. Audit payload facts, not prompt size alone. |
| Editorial additions | 7,069 chars | Purpose-bounded | No wardrobe-wide tool controller. |
| Piece evaluation | 2,014 chars | Purpose-bounded | No universal prompt. |
| Intake, tagging, import, image rendering | dedicated task prompts | Out of styling-controller risk | Keep separate; do not add Style Constitution or wardrobe memory unless the task actually needs it. |

## Confirmed ownership failures

### 1. Tone classification owned execution reachability

The client’s `classifyChatTurn` matched the phrase “this is” before checking whether any prior
thread subject existed. `/ask` then used that client mode as a bounded-router gate. The corrective
slice makes fresh client turns `new_request` and gives server reachability to
`freeformExecutionContextEvidence`: actual card, piece, generated-set, history, thread, or recently
discussed-piece evidence makes a turn non-fresh; prose does not.

### 2. The full prompt contained simultaneous conflicting authorities

The captured system described the turn as a correction and instructed the model not to regenerate,
while the user explicitly requested a new complete outfit. It established `60°`, activity `none`,
and the home location, while the request and later tool call supplied Vienna, 60→48°F, breeze, and
walking. Structured tool resolution eventually preserved the stated weather, but the model still
had to reason through contradictions that should never have entered its decision surface.

### 3. Semantic consolidation lacked a projection budget

Canonical owners made facts more reliable, but there is no registry stating which flow needs which
projection. A fact being available became weak permission to include it. The missing architectural
unit is a flow projection contract, not another universal semantic layer.

### 4. Message transport was mistaken for conversation semantics

The UI appends the current message to `history` before sending. Removing that duplicate only when
assembling the final provider messages was insufficient: routing and conversation-mode decisions had
already consumed it. One shared projection now distinguishes semantic prior history from the wire
shape. This is an ownership correction, not a special case for the Vienna wording.

### 5. Tool results bypassed the execution-profile boundary

Prompt ownership does not end at the system and tool schemas. Tool results are appended to model
history and can re-expand a narrowed flow. `declare_intent` returned instructions for
`generate_outfits`, `plan_outfit_set`, `suggest_slot_swaps`, and `get_garment_details` even though
none existed in the `single_outfit` catalog. The executor now uses the already-resolved profile to
project only its reachable contract. This keeps shared intent state canonical without restoring a
universal prompt through the back door.

## Proposed continuation — owner review required

1. Define an execution-profile registry for `/ask`: profile, required context evidence, allowed
   tools, canonical projections, history/memory scope, and fallback disposition.
2. Extract shared model-facing invariant fragments beside their canonical runtime owners. Flow
   prompts may interpolate them; they may not independently rewrite weather, activity, layer, or
   construction meaning.
3. Give every dynamic prompt block a declared scope and primary reader. Record its character/image
   contribution in provider captures so an unrelated block is observable rather than anecdotal.
4. Audit selected-piece visual styling next. The complete occasion/activity profile dump is the
   clearest non-`/ask` analogue to the confirmed problem and has a straightforward resolved-profile
   projection boundary.
5. Audit outfit evaluation after that. Do not remove its memory blocks by size alone: first classify
   each row as exact outfit evidence, applicable owner guidance, broad taste calibration, or
   unrelated history, then ask the owner which soft channels belong in a critique.
6. Keep capsule and trip decisions separate. Their bounded roster/composition/repair structure is
   evidence that consolidation works when shared meanings and flow strategy remain distinct.

## Acceptance for later implementation slices

- Every removed instruction or fact has a surviving canonical owner and named consumer.
- A flow receives no tool it cannot legitimately call.
- Fresh execution and continuation are decided from state evidence, never keyword tone alone.
- Conflicting representations of location, activity, weather, card state, or owner guidance are
  resolved before the provider call.
- Captures report base prompt chars, dynamic text chars, images, tool count, and iteration count by
  flow/profile.
- Existing cross-flow validity fixtures stay unchanged unless an owner-ratified behavior change is
  the explicit purpose of the slice.

## Carried forward for the audit — categorical "never" rules with no structured owner (2026-09-12)

Found during the weather-architecture branch review. **Not acted on here**: the weather work removed
prompt rules that contradicted structured owners it had just built, which is a different claim from
"this taste rule is wrong". These are recorded so they are examined deliberately rather than carried
forward as ratified style authority by default.

`editorialNewPiecesTemplate` (`styling-engine/prompts.js`, "Hard anti-drift rules — NEVER suggest
these regardless of the anchor piece"):

- *"No beige/cream cardigan as a layer (this is the primary catalog-drift signal)"* — a specific
  colour-plus-category prohibition applied unconditionally. The parenthetical is the tell: it is a
  symptom heuristic for generated-catalog drift, not a styling judgment, and it bans a garment the
  owner's own wardrobe contains.
- *"No scarves as a default styling element"*, *"No blazer unless the anchor piece specifically
  calls for structure"*, *"No soft skirt + soft unstructured shoe"*, *"No all-neutral
  cream/taupe/beige harmony without a dark grounding element"* — same shape.

The questions the audit should ask of each: is this the owner's ratified taste or an incident
patch; is it per-user (docs/feedback-and-memory-map.md: personal preference must not ship as a
global rule); and does a structured owner already hold it — the last item on that list ("No tucking
when the anchor piece has a design hem or is noted as wear-over-only") is simply `tuck_behavior`,
restated in prose, and should be cited rather than duplicated.

Precedent from this branch: a prompt rule is safe to delete when a structured owner can reject the
same thing on evidence. Where none exists, the rule needs owner ratification, not quiet retention.

## Measured: constitution-layer coverage across prompts (2026-09-13)

Found while adding `working_style` to the missing-layer repair template, which shipped with four of
the five ratified stylist layers. A sentinel build (each layer replaced with a unique marker, then
matched per prompt) shows the omission is not unique to that template:

| prompt | layers | missing |
| --- | --- | --- |
| `STYLIST_SYSTEM`, `SINGLE_OUTFIT_STYLIST_SYSTEM`, `STYLE_SELECTED_ITEM_SYSTEM` | 5/5 | — |
| `WHOLE_WARDROBE_MISSING_LAYER_REPAIR_SYSTEM` | 5/5 | — (as of this change) |
| `WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM`, `OUTFIT_COMPOSER_SYSTEM`, `GENERATE_OUTFIT_IDEAS_SYSTEM`, `OUTFIT_BOARD_PLANNER_SYSTEM`, `EDITORIAL_NEW_PIECES_SYSTEM` | 4/5 | `working_style` |
| `COMPARE_OUTFITS_SYSTEM`, `OUTFIT_EVALUATOR_GATE_SYSTEM`, `WHOLE_WARDROBE_EVALUATOR_SYSTEM` | 2/5 | `proven_formulas`, `aesthetic_gravity`, `working_style` |
| `OUTFIT_EVALUATION_FOLLOWUP_SYSTEM` | 1/5 | all but `body_contract` |

**Not acted on.** Whether an evaluator prompt should carry the same layers as a composition prompt is
a real question — an evaluator arguably should not be told the wearer's working style before judging
a submitted outfit — and widening any of these is a prompt change with its own byte deltas and its
own review. Recorded so the next reader sees a measured table rather than assuming uniformity.
`test/prompt_equivalence.test.js` pins the repair prompt at 5/5 with sentinels and carries a note
pointing here; reproduce the table by building prompts with a sentinel constitution.

## Carried forward for the categorical-prompt audit — coat / three-layer weather formula (2026-09-13)

**Resolved 2026-09-15 (owner ruling).** The Whole Wardrobe composer prompt carried a weather formula
in prose, from `styling-engine/prompts.js` (the shared `PHYSICAL_WEARABILITY_REALISM_RULES` block,
used by every composer that interpolates it — Whole Wardrobe, single-outfit, propose_outfit, and the
saved-variant composer):

> *"Thermal Adequacy: Cold outdoor exposure requires real upper-body insulation: choose an insulating
> coat over a top or base layer, or construct an intentional 3-layer system with a middle knit layer
> (such as a cardigan or vest) beneath an outer jacket when appropriate. Standalone uninsulated
> lightweight tops or shells are not warm enough on their own for sustained cold outdoor exposure."*

This prescribed garment formulas (coat over top, or knit-under-jacket) for a question that belongs to
the model's judgment from recorded facts, photographs, and construction — not a fixed recipe. It sat
beside the COOL-END LAYER guidance in the same prompt (also removed, 2026-09-15, see the amendment in
`docs/engine-behaviour-map.md`). A first replacement still named the retired formula in order to
disclaim it ("there is no required insulating-coat-or-three-layer-system prescription") — a second
owner pass removed that meta-negation too, since spelling out the old rule to reject it still gave it
presence in the prompt. Final wording states only the positive task: *"Thermal Adequacy: For cold
outdoor exposure, judge the protection of the whole worn system against the stated exposure, from
each garment's own recorded facts, photographs, and construction. If protection looks inadequate,
explain the concrete shortfall — what is missing and why — from what you can see and what is
recorded."* No formula, no named category, no reference to what used to be required — the model
states a shortfall and its reason rather than being told which categories fix it.

**Resolved in the same pass, not deferred:** the whole-wardrobe feedback header ("avoid repeating
these exact combinations, piece roles, formulas, or occasion mismatches") contradicted the
exact-reaction lines elsewhere in the prompt ("Do not infer dislike of its formula, silhouette,
colors, or individual garments"). It now follows the narrow evidence authority: each line is a
reaction to one exact combination, and its formula, roles and occasion identify that combination
rather than acting as rules. The composer's wrapper ("rejected pairings are settled — do not repeat
them") was aligned the same way.

### Resolved 2026-09-13 as a schema-contract correction — composer layer-direction wording

Resolved in the same change: the composer now projects `layerDirectionPromptRule({ vocabulary: 'slots' })`.
Original record:

After atomic structured output, the visual composer prompt still projects `layerDirectionPromptRule()`
verbatim, which explains direction in terms of "a `layer_top` role". The composer no longer emits
roles; it names slots. The rule is shared with `propose_outfit`, so it was left unchanged here rather
than forked into a composer-local restatement.

