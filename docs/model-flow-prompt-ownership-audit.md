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
