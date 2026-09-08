# Single-outfit weather layer — vertical slice

> **Live-routing correction, 2026-09-07:** `thread_1788814890775` did not evaluate this slice: the
> client misclassified the fresh brief’s sentence “This is ordinary sightseeing” as a correction,
> and the server skipped the execution router entirely. Freshness is now derived from actual context
> evidence rather than that tone label. A repeat live run is still required before accepting the
> isolated prompt or its outfit quality.

> **Second live-routing correction, 2026-09-07:** `thread_1788817405702` called the router but was
> assigned `execution_profile:'full_stylist'` rather than `single_outfit`. The current request was
> still present at the end of the client’s transport `history`, so the router saw it as both its
> recent exchange and current request; after fallback, the full builder also treated it as prior
> context and labeled the turn `correction`. The full-stylist path nevertheless continued through
> `declare_intent → search_wardrobe → propose_outfit` and produced an accepted card, which exposed
> the separate shared-validator defect recorded in the fourth finding below. That card is evidence
> for the shared proposal validator, not evidence that the isolated `single_outfit` profile worked.
> `priorStylistConversationHistory` now removes the exact trailing transport copy before all
> freshness, routing, mode, and history-budget consumers. Another isolated-profile run remained
> required.

**Status:** ratified and implemented 2026-09-06; six live acceptance findings on 2026-09-07 exposed
additional narrow defects. Findings one through five were corrected and offline-verified; the sixth
requires the proposed system-aware roster redesign before another live check. Amended after owner review
to make the canonical temperatures an explicit wearing-window exposure rather than a daily
high/overnight-low envelope, after technical review to close declaration omission, and after the
the first live run exposed construction-validation, thermal-projection, visual-coverage, and routed-
context gaps, the second exposed stated-range, activity-authority, known-undershoot, sleeve-bulk,
and rejected-state gaps, and the third exposed request-text activity re-inference plus an incorrect
thermal credit for ordinary walking.

## 1 · The product question

Can Closet style **one ordinary outfit** for explicit weather and reliably include a removable,
weather-appropriate layer when the user asks for one?

Canonical request:

> Style one outfit for an afternoon and early-evening outing in Santa Fe in late October. I will be
> outside from 3–8 p.m.; it will be about 60°F when I leave and 48°F after sunset when I return. It
> will be dry with a light breeze. Include a removable layer.

This is deliberately not a trip-planning problem. It has one occasion, one activity, one exposure
window, one outfit card, and one explicit layer obligation. It is the smallest surface on which the
weather work can prove that it helps dress a person.

## 2 · Why this slice exists

PR #315 built useful shared weather foundations inside a much larger trip system: structured weather
provenance, per-garment thermal facts, environmental hard constraints, plan rosters, packing logic,
atomic multi-look composition, a required `cold_layer_decision`, and bounded repair. The product
signal was then hard to read because a failure could originate in routing, slot decomposition,
roster construction, packing reuse, model composition, validation, or repair before it reached the
simple question of which jacket belongs with an outfit.

The smaller slice keeps the useful foundation and removes those confounders. It also reverses the
presentation compromise that motivated the trip UI: a layer is not a shared packed annotation. It is
part of the outfit's visual core, present in the card's ordinary `piece_ids`, because the relationship
between the base and the layer is itself a styling decision.

## 3 · What the current code already gives us

The ordinary serial path is already close to the desired architecture:

```text
declare_intent(want: cards, outfit_count: 1)
  → search_wardrobe(explicit weather, occasion, activity)
  → model sees garment images + thermal facts
  → propose_outfit(piece IDs, including the layer)
  → deterministic structural and environmental validation
  → one ordinary outfit card
```

Evidence, traced 2026-09-06:

- `executeTool`'s `search_wardrobe` branch resolves canonical weather, applies automatic-use hard
  eligibility, and emits `thermalFactsForPieceLine` for each result. It does not sort candidates by a
  derived thermal verdict.
- `executeTool`'s `propose_outfit` branch inherits the same resolved weather, requires proposed pieces
  to have been visually seen, and calls `evaluateWearableOutfit` with that weather context.
- `stylistSystemTemplate` already says `propose_outfit` owns one specific outfit and
  `generate_outfits` owns a fresh same-context batch.
- Neither the single-outfit path nor its card needs a trip roster, trip plan, packing relation,
  `cold_layer_decision`, or repair composer.

This means the first implementation should extend the serial path, not extract a smaller trip plan.

## 4 · The two concrete defects

### 4.1 The layer request is prose, not a contract

The model can understand “include a removable layer,” but no structured turn fact records that this
was an explicit user requirement. `propose_outfit` validates the outfit it receives; it cannot
distinguish “the model omitted an explicitly requested layer” from “the user never asked for one.”
Prompt repetition cannot make this mechanically observable.

### 4.2 A one-outfit request has an alternate route that loses weather

The `generate_outfits` tool description still permits an explicit “one” or “best” request to use
`limit: 1`. But `declareBoundedMultiLookIntent` deliberately treats a fresh one-look request as not
bounded, and the `generate_outfits` branch only forwards `resolvedWeatherProfile` to
`generateWholeWardrobeOutfitsVisualInternal` when the call is a bounded multi-look request. It also
does not forward that branch's `user_weather`, `location`, or `date` arguments.

So the alternate one-look route can discard the weather the user just supplied and let the nested
composer resolve a different context. Existing observability tests currently pin that distinction.
This is a routing-contract contradiction, not a styling-calibration problem.

The direct visual composer has a second, related limitation: `composerPieceLineSuffix` labels
candidate images with ordinary garment attributes but not the warmth, insulation, interior,
season, or removability facts now used by the serial search path. Expanding that batch composer is a
separate follow-up, not part of this slice.

### 4.3 A daily forecast envelope is not an activity exposure window

The first draft described 60→48°F as a generic daytime-to-evening range, then tried to find a city
whose daily high/low made it plausible. That was backwards. A forecast low commonly occurs near dawn,
outside the requested activity entirely. Applying a day's high and overnight low to a lunch, museum,
or dinner slot manufactures cold exposure and can make the system overdress daytime activities.

The contracts are distinct:

- **daily weather envelope:** the calendar day's high and overnight low;
- **activity exposure:** conditions during the hours the outfit is actually worn for that activity;
- **transit exposure:** conditions during arrival or departure, which may justify a removable layer;
- **unobserved overnight temperature:** irrelevant to that outfit.

This slice tests explicit user-stated activity exposure so weather retrieval and styling judgment do
not fail in the same experiment. A later integration slice must map timed activity slots to hourly
conditions. When only daily high/low is available, it must not silently assign the daily low to every
slot.

## 5 · Target contract

### 5.1 One route

For a fresh request for exactly one outfit, the only supported freeform tool route is:

1. `declare_intent({ want: 'cards', outfit_count: 1, layer_requirement: ... })`
2. one or more visual `search_wardrobe` calls
3. exactly one accepted `propose_outfit` call

`generate_outfits` is a **2–5 outfit batch tool**. A freeform `generate_outfits` call with `limit < 2`
must return a local validation response directing the model to `search_wardrobe` and
`propose_outfit`; it must not make a nested model call. This restriction is local to the freeform
tool contract and does not remove single-card support from unrelated direct endpoints.

### 5.2 One narrow structured request fact

Extend `declare_intent` with a required enum:

```json
{
  "layer_requirement": "required | unspecified"
}
```

- `required` means the user's current message explicitly asks that the outfit include a removable
  layer.
- `unspecified` means there is no explicit layer obligation. It does **not** mean “do not use a
  layer”; the model remains free to choose one from the weather facts.
- There is intentionally no `forbidden` value in this slice.
- The conversational model translates the user's language into the enum. Deterministic code must not
  infer it with keywords or substring matching.

The value lives in turn-local `toolContext`, alongside the declared card count and resolved weather.
Every explicit `declare_intent` call for cards must state it, so omission cannot silently erase the
obligation. The narrow 2–5 batch tool's existing implicit declaration records `unspecified`
internally; it must not create a new model round trip merely to state the default.

If `want === 'cards'` and `layer_requirement` is missing or invalid, the local `declare_intent`
handler returns `validation_error` and instructs the model to repeat the declaration with `required`
or `unspecified`. It must not silently coerce an omitted value to `unspecified`. Text and image
declarations do not acquire a layer requirement; this validation is conditional to card intent.

### 5.3 Mechanical presence, model-owned appropriateness

When `layer_requirement === 'required'`, `propose_outfit` must reject an otherwise valid proposal that
contains no removable layer. A qualifying layer must:

- be an actual proposed piece in the card's normal `piece_ids`;
- have been visually seen on this turn under the existing evidence contract;
- occupy an ordinary layer role; and
- be identified from structured garment category/role data, not from its name or notes.

The implementation uses the existing `outerwearPieces()` predicate in
`outfitEnvironmentalAdequacy.js`, which identifies outerwear through
`wardrobeCategoryGroup(piece) === 'outerwear'`. It must not revive or extend the deprecated
`outerwear_role` ontology, and it must not encode garment IDs or names.

The validator enforces **presence**, structural validity, owner constraints, activity safety, and the
existing environmental hard constraints. It does not choose or rank layers, and thermal overshoot
remains advisory. For this one narrow contract, a known thermal undershoot becomes hard only when
the user explicitly required a layer and the stated encountered range is certain; incomplete garment
evidence and coarse forecast estimates can never trigger that hard result. The model sees candidate
images plus factual warmth, insulation, interior, season, protection, and removability evidence and
owns the contextual choice among candidates that can actually meet the request.

If no eligible removable layer exists, the result is an honest wardrobe gap. The engine must not add
a coat automatically, substitute an unseen piece, or weaken the user's requirement.

### 5.4 One weather identity

The explicit numeric weather is the user's stated **3–8 p.m. wearing-window exposure**, not a daily
forecast envelope. It is resolved once through the existing canonical resolver and inherited by every
search and the proposal. The implementation must prove that the same resolved context—not a fresh
home-weather lookup or season fallback—reaches:

- candidate eligibility;
- the model-facing search response;
- final outfit validation; and
- the resulting card's weather fields.

No new weather scoring, temperature tier, or garment classification belongs in this slice.

## 6 · What is deliberately out of scope

- trips, date ranges, multi-day slots, capsules, packing lists, and roster reuse;
- shared packed layers or assigned-layer relations outside `piece_ids`;
- `plan_outfit_set`, `submit_plan_outfits`, `cold_layer_decision`, and repair passes;
- redesigning `generateWholeWardrobeOutfitsVisualInternal` or its image manifest;
- selected-piece batch generation;
- hourly forecast retrieval and trip-slot time mapping. Those are a necessary later integration
  slice; this slice isolates styling with an explicit user-stated wearing window;
- a new layer taxonomy, warmth score, weather-fit label, or thermal rank. This slice only consumes
  the existing thermal band as a narrow hard-validity check when a required layer and certain stated
  exposure make known undershoot directly falsifiable;
- wet-weather, wind, humidity, or precipitation-specific acceptance cases;
- UI redesign. The existing ordinary outfit card is the surface. If implementation reveals that a
  visible UI change is necessary, it requires the standing UI expert panel before that redesign.

## 7 · Acceptance contract

### Offline, deterministic

1. **Routing:** a declared one-outfit request proceeds through search + propose. Freeform
   `generate_outfits(limit: 1)` is rejected before any nested model call; limits 2–5 retain current
   behavior.
2. **Required enum:** every cards declaration supplies `layer_requirement`. Missing or invalid values
   return `validation_error`; `required` persists for the turn; `unspecified` creates no new layer
   obligation. Non-card declarations are unaffected.
3. **Presence:** with `required`, a proposal with no layer is rejected with a specific, speakable
   reason. A proposal containing an eligible, visually verified removable layer can proceed.
4. **No role spoofing:** labeling a non-layer piece `role: 'layer'` does not satisfy the contract.
5. **Visual evidence:** an unviewed layer cannot be smuggled into the proposal.
6. **Weather continuity:** the explicitly stated 3–8 p.m. exposure represented by
   `{ high_f: 60, low_f: 48 }` remains the canonical context across search, validation, and card
   persistence; no network weather lookup is attempted and no daily forecast claim is made.
7. **Facts, not verdicts:** searched layer candidates expose source-specific thermal facts. No new
   `weatherFit`, thermal preference score, or hidden warmth sort is introduced. Finite image slots
   cover distinct structured outerwear-construction evidence rather than repeating one early
   retrieval shape; this changes sight coverage, not returned-row order or eligibility.
8. **Honest gap:** when every removable layer is suppressed, prohibited, or environmentally invalid,
   the tool reports the gap and makes no paid repair call.
9. **No-op:** with `layer_requirement: 'unspecified'`, no new hard thermal constraint appears apart
   from the tightened one-vs-batch route. With weather absent, no new thermal behavior appears.
10. **Isolation:** trip, capsule, and existing 2–5 bounded-batch tests have no output diff attributable
    to this slice.

### Live acceptance finding and corrective contract — 2026-09-07

The first live check returned two structurally accepted but product-invalid cards. One used the
striped knit cardigan for sustained 48°F breezy exposure; the other put a deep-armhole mock-neck top
under a fitted-sleeve knit duster. Provider capture established four separate causes:

- role-aware layer-pair enumeration visited `layer_top` but skipped the dedicated `outerwear` role,
  so the existing sleeve-conflict verdict never examined the mock-neck/duster pair;
- model-facing `insulation:insulated` collapsed wool face-fabric evidence and a recorded engineered
  insulating layer into one stronger-sounding construction claim;
- the weather-aware batched search returned coats and jackets in text, but its finite outerwear image
  slots were consumed by the earliest cardigans/shrugs;
- the execution router resolved occasion/activity, but a `full_stylist` turn discarded that
  structured result, allowing an argument-omitting search to fall back to route defaults.

The correction remains inside the original boundary: existing structured sleeve mechanics now also
enumerate `outerwear`; thermal projection names `insulating layer` separately from `insulating face
material`; image allocation preserves result order but spreads finite sight across structured
constructed/filled/unfilled/unknown outerwear evidence; and new-request router occasion/activity
become established tool context while explicit occasion arguments retain precedence. Router activity
is request-level authority and cannot be replaced by a later model-authored tool argument. No new
warmth score, garment-specific code rule, deprecated `outerwear_role` reader, or paid repair loop is
added.

### Second live acceptance finding and corrective contract — 2026-09-07

The next two UI runs (`thread_1788767672302`, `thread_1788767789621`) proved the visual-evidence
correction worked: both turns saw cardigans, jackets, a hoodie, a trench, a down coat, and a puffer.
They nevertheless accepted the uninsulated cream trench for the stated 60→48°F breezy exposure,
including over a sleeveless base. Captures and persisted runs isolated four remaining mechanical
errors rather than one aesthetic disagreement:

- `resolveConditions` treated the stated 48°F return temperature as a daily pre-dawn trough and
  rewrote it to 52.2°F. A `stated_user` range now remains the encountered range, is non-coarse, and
  is labeled `stated_user_exposure_range`; live/model daily envelopes still use the disclosed waking
  estimate.
- Both turns invented `activity:'walking'` after the execution router had resolved `activity:'none'`,
  incorrectly activating footwear constraints and lowering thermal demand. New-request router
  activity is now locked as request-level authority through search and proposal.
- Presence alone let a known-light layer satisfy an explicit weather-layer request. The existing
  thermal band now hard-rejects known undershoot only for this explicit required-layer contract with
  certain stated exposure. Default, coarse, unknown-evidence, plan, and overshoot behavior remains
  advisory.
- The sleeve validator called two `fabric_weight:'medium'` garments bulky and rejected an ordinary
  ¾-sleeve jersey beneath a trench. Overall garment weight is not sleeve-volume evidence; hard
  sleeve conflicts now require recorded directional sleeve geometry. Rejected retry cards are also
  filtered from persisted `current_outfit_set`, so only accepted cards become follow-up authority.

Acceptance criteria become permanent tests. The stated-range change affects exposure consumed by
ranking, so the provider-free ranking A/B harness is required even though no score or garment
classification was added.

### Third live acceptance finding and corrective contract — 2026-09-07

`thread_1788770518010` accepted the moderate Whale stripe tee plus moderate, explicitly
non-insulating cream trench for the stated 60→48°F exposure. The capture made the causal chain
fully observable:

- the execution router established `activity:none`;
- the model did not pass an `activity` tool argument, but wrote “gallery walk” into its own
  `occasion_context`;
- the shared activity-profile resolver inferred `walking` from that model-authored prose despite
  the router lock; and
- `walking` lowered demand from `warm` to `moderate`, allowing the known-moderate outfit through.

The owner corrected the underlying product rule: sightseeing is not running. Ordinary walking can
increase the duration of outdoor exposure and is not a dependable body-heat credit. It continues to
govern footwear and remains an observable exposure fact, but it does not lower clothing warmth
demand. Only genuinely exertive hiking retains a base-clothing thermal discount; removable-layer
demand receives no activity discount because the layer must serve stops and other low-output
periods. Independently, a router activity
lock now suppresses secondary request-text activity inference as well as structured tool overrides;
an authoritative `none` must remain `none` even when later model prose invents a walk.

The permanent regression bracket is therefore:

- stated 60→48°F with `activity:none` demands `warm`;
- stated 60→48°F with `activity:walking` also demands `warm`;
- model-authored “gallery walk” cannot alter router-authoritative `none`; and
- the moderate tee plus moderate uninsulated trench remains a known undershoot in either case.

### One budgeted live check

After offline acceptance passes, preview the request count and estimated provider cost before any
paid run. Then run the canonical request through the normal chat UI/provider path and verify:

- one ordinary outfit card is returned;
- its `piece_ids` include the removable layer;
- the layer was searched and visually inspected on the same turn;
- the card and explanation use the stated 60/48°F exposure;
- no trip plan, roster, packing annotation, or repair pass appears in the trace; and
- the selected layer is visually coherent and does not undershoot the stated cold end, judged from
  the actual outfit rather than from category presence alone.

Visual coherence in the final bullet remains a model-quality observation; known thermal undershoot
under this exact explicit contract is now a deterministic gate. Repeat runs and broader weather
matrices come only after this first end-to-end result is reviewed.

### Fourth live acceptance finding — both worn states must work (2026-09-07)

The same misrouted `full_stylist` run, `thread_1788817405702`, paired a genuinely warm lined wool
coat with a light three-quarter-sleeve satin top. Although it did not validate the isolated profile,
it did reach the shared `propose_outfit` environmental validator and was accepted there. The full
outfit could answer 48°F, but removing the coat at 60°F left an under-warm upper body for continued
outdoor exposure. The owner clarified that a removable layer creates two valid worn configurations:
the complete outfit at the cold endpoint, and all clothing that remains after that actual layer
comes off at the warm endpoint. The remainder may be one suitable top or another compatible layer
system; it is not required to be one garment.

The shared contract therefore evaluates each real one-layer-removal configuration. Warm-end supply
is upper-body supply, so a heavy trouser cannot mask a thin top. A known undershoot is a hard failure
only under this slice's explicit `layer_requirement:'required'` plus certain stated exposure; unknown
upper-body evidence cannot become invalidity. This is a range-coverage correction, not a garment-name
rule, a new taste judgment, or permission to make overshoot a hard filter. Its regression bracket
therefore belongs to shared proposal validation; it is not a routing acceptance case.

### Fifth live acceptance finding — the bounded roster hid the answer (2026-09-07)

`thread_1788822538467` finally exercised the intended narrow route. Its system prompt was 7,142
characters with exactly four tools, and all three proposed cardigan outfits were correctly rejected
as known cold-end undershoots. The run nevertheless returned zero verified cards after eleven
provider calls and 484,683 input tokens. The first weather-aware search capped outerwear at ten rows
before image allocation; those ten contained only `very light`, `light`, `moderate`, and unknown
warmth. Known `warm` and `very warm` layers—including lined coats—were outside the roster. A final
free-text search found them, but the model spent its last allowed action viewing a coat and had no
turn left to submit it.

The cap now preserves evidence breadth without choosing an outfit: under resolved numeric weather,
it retains the first outerwear representative of every observed `garmentWarmthLevel`, fills the
remaining slots in retrieval order, and restores retrieval order in the returned roster. The total
remains ten; non-outerwear categories, non-weather searches, and other execution profiles are
unchanged. This is not a thermal-fit rank because it never reads the requested demand or compares a
piece with conditions.

The same capture exposed one remaining ownership leak. The dedicated system prompt named four
tools, but the subsequent universal `declare_intent` success message discussed
`generate_outfits`, `plan_outfit_set`, `suggest_slot_swaps`, and `get_garment_details`, none of which
were available. The single-outfit profile now receives a short success contract limited to batched
search, optional focused viewing, proposal, endpoint judgment, and validation repair. The general
declaration response remains unchanged for every other flow.

### Sixth live acceptance finding — label coverage is not decision coverage (2026-09-07)

`thread_1788846530795` proved the fifth correction fixed control flow but not the roster abstraction.
The turn followed `execution_router → declare_intent → search_wardrobe → propose_outfit`, used one
search and one accepted proposal, and incurred no validation repair. Its six photographed outerwear
choices nevertheless reduced the real weather decision to an uninsulated leather jacket versus a
down-lined winter coat, with light/moderate cardigans occupying the other slots. A warm black wool
coat in the hard-eligible wardrobe was absent from both the ten-row truth roster and the visual set.

The fifth correction preserved one candidate from every `garmentWarmthLevel`. That is categorical
coverage, not meaningful choice: two pieces in the same ordinal level can have materially different
insulation, interior construction, protection, length, and burden across the wearing window. The
model selected the winter coat because the bounded evidence offered no proportionate insulated
middle option, not because its prompt misunderstood 48°F.

The proposed [system-aware weather roster](system-aware-weather-roster-spec.md) replaces independent
category/warmth sampling on this route. It retains a complete compact eligible index and constructs
the bounded visual working set as the atomic union of several mechanically feasible whole-outfit
paths, using the same shared hot/cold and structural owners as final proposal validation. This is not
implemented; do not treat the current fifth correction as live-accepted.

## 8 · Ratified real-wardrobe fixture bracket

The following records were inspected read-only from a copied SQLite database on 2026-09-06. They are
useful because they bracket the choice without inventing synthetic garments. The owner reviewed and
ratified these as expectations for this one stated exposure on 2026-09-06; they are not universal
taste rules or garment-specific production rules.

| piece | recorded evidence | expectation for the stated 3–8 p.m. 60→48°F exposure |
|---|---|---|
| `cream trench coat with belt` (996759) | medium cotton, long sleeve, full lining, explicitly non-insulating, wind protection; derived factual warmth `light` | insufficient as the weather layer over a sleeveless or light-to-moderate base for a stationary breezy return at 48°F |
| `olive green lightweight jacket` (996767) | medium cotton, long sleeve, unlined, explicitly non-insulating, wind protection; derived factual warmth `light` | likewise insufficient as the sole weather layer for this acceptance exposure unless the rest of the outfit independently supplies known warm coverage |
| `thin UPF technical hoodie` (990358) | ultralight, unlined, explicitly non-insulating, no recorded weather protection; warmth not assignable from current evidence | likely too insubstantial for this exposure |
| `Black puffer coat` (996775) | heavy synthetic, down insulation, very warm, cold-weather outerwear | thermally workable at the cold end, but likely too burdensome across the whole exposure |

The acceptance fixture should offer at least one candidate from each side of that bracket. The model
should receive all facts and images and make the choice; tests may assert that no deterministic
thermal ranking removed or promoted one. Deterministic tests do not require a named piece to win;
that remains a live model-quality judgment. Piece IDs remain test data only and must never enter
engine code.

## 9 · Implementation sequence

1. Tighten the one-vs-batch tool contract and its routing/observability tests.
2. Add the required `layer_requirement` declaration field and turn-local state.
3. Add the narrow layer-presence validation to `propose_outfit` with specific diagnostics.
4. Add weather-continuity, visual-evidence, honest-gap, and no-op acceptance tests.
5. Amend the freeform flow and behavior-map documentation in the same code change.
6. Run the full offline suite.
7. Present the real fixture images for owner confirmation, then perform the separately authorized,
   cost-previewed live check.

The implementation is successful when this one request is boring: one weather context, one visual
search, one model styling judgment, one validated outfit card, with the layer visibly part of the
look.
