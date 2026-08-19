# Freeform bounded execution profiles

**Status:** phase 1 implemented and live-tested; follow-up profiles on `codex/freeform-rearchitect-followup`, 2026-08-19
**Authority:** expands `freeform-rearchitecture-handoff.md`; it does not supersede model-owned intent

## Problem

The freeform stylist currently pays for one general agent loop even when the requested product is
already narrow. The measured nature-walk turn produced three looks over six provider iterations and
cost $0.325 after search-payload trimming. Its approximately 41k-token prefix is read on every
iteration, so reducing result-row tokens cannot take the current architecture below roughly $0.21.

The cost is orchestration, not the visual judgment itself. A normal multi-look turn commonly asks
the outer model to declare intent, search several categories, inspect candidates, call
`propose_outfit` once per card, and close the response. Each step re-reads the conversation, full
wardrobe manifest and complete tool catalog.

## Existing capability — do not build a second composer

`generate_outfits` already delegates to `generateWholeWardrobeOutfitsVisualInternal` for a
whole-wardrobe request. That pipeline:

- resolves structured occasion, weather and activity;
- applies the same suppression, trust, register and footwear gates as the Visual Composer;
- builds a capped visual roster (up to 90 pieces);
- attaches the roster photographs and compact garment truth;
- makes one no-tools model call for 1–5 outfits;
- resolves IDs, validates structure and gates, and exposes rejected attempts as needs-review cards;
- fills from deterministic candidates only when the model returns no structurally valid outfits;
- persists generation diagnostics.

The freeform prompt nevertheless says ordinary styling advice should use serial
`search_wardrobe` + `propose_outfit`. A later line says `generate_outfits` is the correct tool for a
single-context fresh visual batch. The two instructions conflict, and the expensive instruction is
the more prominent one.

The redesign promotes and hardens this existing bounded capability rather than adding another
composition engine.

## Philosophy preserved

The conversational model continues to own semantic intent. There is no client keyword pre-route.
The model decides whether the user wants text, one card, a fresh same-context batch, a coordinated
multi-context plan, a capsule, a revision, or an image.

Code continues to own truth, eligibility, IDs, weather physics, activity safety, structural
validity and bounded failure handling. The nested model continues to own visual and aesthetic
judgment over the eligible workbench.

The full freeform tool loop remains the fallback for genuinely open-ended wardrobe investigation.

## Execution profiles

| Product requested | Bounded execution |
|---|---|
| text, explanation, critique | conversational answer; retrieve only when exact garment truth is needed |
| explicit one best/pick-one request | targeted visual search + `propose_outfit` |
| ordinary “what should I wear?” or 2–5 fresh outfits sharing one occasion/activity/weather context | `generate_outfits` once; ordinary request defaults to two options |
| one-slot revision of a current card | `suggest_slot_swaps` once |
| coordinated multi-context set | `plan_outfit_set` |
| seasonal capsule | existing model roster + atomic capsule composition |
| unusual/open-ended wardrobe investigation | full freeform loop |

`generate_outfits` is not appropriate when the cards have different contexts, when the user is
editing an existing set, when a specific selected garment must remain the anchor unless `piece_id`
is supplied, or when the user asked for explanation rather than cards.

## Phase 1 — observable bounded multi-look

1. While the flag is enabled, add a controller instruction that explicitly supersedes the stable
   serial instruction for this one request class, and repeat the boundary in `declare_intent`'s
   acknowledgement. Flag-off prompt bytes remain unchanged during the comparison window.
2. Record nested visual-composer usage in the parent freeform turn. A cost optimization cannot be
   evaluated while its largest call is absent from the turn total.
3. Record an explicit bounded-multi-look diagnostic and tool-sequence marker.
4. After a successful bounded composition, expose no further composing/search tools. The outer
   model gets one closing turn and cannot restart search or rebuild the cards.
5. A shortfall ships as accepted cards plus visible needs-review cards/gap language. It does not
   reopen the general outfit-count retry loop.
6. ~~Keep the behavior behind a flag~~ — **default-on since 2026-08-19, flag removed.** Originally gated until offline contracts and a
   paid live A/B are accepted.
7. The tool result ends the paid loop. Deterministic code writes the short card introduction and
   shortfall language; there is no full-prefix closing model call after validated cards exist.
8. A named location and resolved requested date travel into `generate_outfits`, which resolves live
   weather before roster construction and records `weather_source`. Seasonal text is only fallback.
9. The bounded `generate_outfits` call is itself the cards declaration. It does not spend a separate
   provider iteration on `declare_intent`; the general freeform and one-card contracts still do.
10. Composer prose is checked locally before delivery. Deliberation/self-correction or an explicit
    garment ID outside the final card is withheld and visibly flagged, never repaired by a paid call.
11. An ordinary new “what should I wear?” request defaults to two options. The controller calls
    `generate_outfits` directly without a preliminary wardrobe search. An explicit one/best/pick-one
    request retains the targeted one-card path; an explicit numeric count wins over the default.
12. A multi-option result is a comparison set, not several substitutions inside one template. The
    nested composer is asked to vary formula or silhouette when its eligible visual roster supports
    that choice; activity-safe footwear may repeat when the activity narrows valid shoes. Advisor
    mode still preserves the model's choices—code records formula/silhouette collapse for review but
    does not delete or mechanically replace an outfit.
13. Live weather retains its observed high/low temperatures through the bounded tool boundary. The
    visual composer receives the numeric range rather than only `hot`/`cold`/`mild`, and the local
    no-call introduction names that range and location conversationally. The coarse booleans remain
    the hard-gate inputs; temperature-sensitive layering stays visual-model judgment.

## Quality constraints

- Photographs stay. This work removes repeated orchestration, not visual evidence.
- The roster gate stays identical with the flag off and on.
- The composer receives the same Style Constitution layers and applicable feedback memory.
- No deterministic taste score becomes a hard filter.
- The requested count remains 1–5; actual cards and needs-review outcomes are visible.
- A multi-context request must not be flattened into one generic context to qualify.
- A selected-piece request must not lose its anchor.

## Cost hypothesis

The current same-context three-look trace takes six outer iterations at $0.325. Phase 1 aims to
replace the serial search/propose sequence with one nested visual call and one tool-free closing
turn. The first target is a total turn cost of $0.15–$0.22 without a decline in owner-reviewed
styling quality. This is a hypothesis, not a promised saving.

The builder's historical ~$0.097 is not the target: it carries neither the full freeform prefix nor
the same orchestration. Nested usage must be measured before quoting any result.

### First live result, 2026-08-18

Thread `thread_1787078588118` proved the bounded composition itself: three requested cards, three
structurally valid, hiking retained, and no serial search/propose calls. It did not prove the cost
target. Four calls cost an estimated $0.3840 versus the $0.3247 baseline because the tool-free
closing call wrote another 32,745-token cache prefix. It also exposed a quality defect: the model
claimed it would retrieve live San Anselmo weather, while `weather_source` remained empty and the
composer received only `warm`. Phase 1 therefore removes that closing call and resolves location +
date weather inside the bounded tool before another live comparison.

The second live run, `thread_1787079261414`, reduced the result to three calls and $0.2675, with
live weather restored and three structurally valid cards. It exposed the next boundary: the visual
composer correctly consulted recently-shown memory, but leaked its rebuild deliberation into one
card and left that prose describing discarded IDs. The architecture therefore keeps recency as a
soft diversity preference while enforcing final-card prose integrity locally.

The third live run, `thread_1787089704692`, exposed a hybrid route: the controller first searched,
then invented `limit:2` and entered bounded composition. Three paid iterations cost about $0.3376,
and `watchFor` narrated that a tee was recently shown. Owner ruling: an ordinary “what should I
wear?” should offer options; default to two. The direct bounded instruction and tool descriptions
now state that default, and prose integrity covers `watchFor` and `stylingInstructions` as well as
`reason`.

The fourth live run, `thread_1787093817045`, reached the intended two-iteration shape but exposed
the remaining architecture cost. The full controller wrote approximately 40,353 cache-creation
tokens before doing only one useful thing: choosing `generate_outfits` and its arguments. The
nested photograph-aware composer used approximately 41,105 more cache-creation tokens. Total cost
was approximately $0.326, so removing serial tools alone did not remove the duplicated full-context
read. The same run also proved two quality requirements now fixed offline: exact forecast highs and
lows must survive the weather boundary, and local closing prose must sound like styling advice,
not telemetry (the rejected line was “wardrobe-verified outfits for this request”).

## Phase 2 — small model-owned execution router (flagged, 2026-08-18)

The execution router (default-on since 2026-08-19, flag removed) adds one compact
structured model call before the full
payload is assembled, only for a new request with no active piece/outfit/image context. The router
sees the user's sentence, current date and timezone—no wardrobe manifest, photographs, Style
Constitution or general tool catalog. It may choose only `bounded_multi`, with normalized composer
arguments and a count of 2–5, or `full_stylist`, which falls through unchanged.

The narrow choice directly invokes the existing `generate_outfits` tool and returns its validated
cards with deterministic conversational introduction/shortfall prose. It does not construct the
full stylist payload or make the outer controller call. `full_stylist`, malformed router output,
router failure, or an unsuccessful bounded composition all retain the old path. One/best requests,
text advice, critique, photos, existing-outfit work, named/selected pieces, revisions, capsules,
packing, multi-context plans and ambiguous requests are explicit conservative fallbacks.

This expands model-owned intent rather than returning to keyword pre-routing: a small model owns
execution-profile judgment; deterministic code enforces the profile boundary and existing truth
contracts. The visual composer still receives photographs, garment truth, Style Constitution
layers and applicable memory. The removed context is orchestration context, not styling evidence.

The parent row records `execution_router_calls`, router usage, nested composer usage and
`tool_sequence=execution_router;generate_outfits`. The initial projection was $0.17–$0.18: the
nested composer plus a small routing call, instead of the nested composer plus a ~$0.154 full
controller. The corrected live result below beat that projection at approximately $0.146.

**First Phase 2 live result, `thread_1787096409835`.** The router path worked: cache creation fell
from 80,921 to 43,682 tokens and measured cost from ~$0.324 to ~$0.186 (about 43%). The router's
`casual` farmers'-market occasion is owner-accepted for this app. It also exposed a boundary bug:
the live 78°F/56°F profile correctly said not hot, but the composer re-parsed the router's `summer`
season string and activated hot gates, suppressing 59 insulating pieces plus 20 fiber matches.
Live resolved weather now owns hard hot/cold physics through composition; season remains aesthetic
context and the existing heuristic remains the fallback when live weather is absent.

## Phase 3 experiment — adaptive visual evidence (flagged, 2026-08-18)

Adaptive visuals (default-on since 2026-08-19, flag removed) apply only to a bounded whole-wardrobe batch. Instead of
flattening every garment photo to 768px, it uses the app's existing structured visual-detail policy:
complex pattern, expressive-role and textured pieces receive 800px; plain pieces receive 448px.
Roster membership, garment truth, photographs and model remain identical. Every other composer
retains 768px. Debug output records the actual image-size distribution.

Provider-free reconstruction of the corrected Larkspur casual/walking roster produced 80 images:
40 complex at 800px and 40 plain at 448px, versus 80 at 768px today. That is 28.7% fewer total image
pixels while slightly increasing evidence for the pieces hardest to judge.

**Invalid live attempt, `thread_1787097350838`.** This run repeated the prior 43,682 cache-creation
tokens and the same erroneous hot roster because the implementation passed both
`resolvedWeatherProfile` and `adaptiveVisualDetail` to `generateOutfitsForPieceInternal`, while the
bounded flow calls `generateWholeWardrobeOutfitsVisualInternal`. Neither experiment executed. The
arguments were moved to the correct branch and the source contract now extracts each call block,
asserting presence on whole-wardrobe and absence on selected-piece. Do not cite this thread as an
adaptive-image or weather-fix result.

**Corrected Phase 2 + Phase 3 live result, `thread_1787097967248`.** The exact live
77.9°F/56.2°F profile reached composition, the erroneous hot-weather exclusions disappeared, and
the composer returned two structurally valid cards. Adaptive evidence reduced cache creation from
43,682 to 32,398 tokens. Total measured usage was 2,436 ordinary input, 1,145 output, and 32,398
cache-creation tokens, estimated at ~$0.146 at the recorded provider rates—about 55% below the
original ~$0.324 baseline. This accepts the architecture and adaptive-evidence experiment for this
request class; it does not establish a broad quality distribution across unrelated request types.

**Named-place forecast failure, `thread_1787098654251`.** A Berkeley dinner request reached the
correct bounded path but weather resolution failed and silently fell back to router text
`summer; hot weather`. That activated hot gates, suppressing 59 insulating pieces plus 20 fiber
matches and producing two explicitly warm-night cards. Recent-piece memory did not cause this;
the roster was already wrong. A named location whose lookup fails now yields an observable,
physically neutral `weatherSource:"unavailable"` profile. It cannot be reinterpreted as hot/cold
from calendar season, and the no-call introduction tells the user the forecast was not verified.
No-location requests retain the existing season/text heuristic.

**Dinner register and wear-mechanics correction, `thread_1787099389227`.** The compact router
classified “dinner with friends” as casual and invented walking, imposing the everyday ceiling and
removing 48 elevated plus 11 dressy pieces despite a correct live 70°F/59°F forecast. The router
contract now follows the app's established occasion semantics: generic restaurant dinner is city
smart casual, explicit date/night-out/dressy dinner is evening, and friendship does not lower the
register; travel to a named place does not itself establish walking. The same thread exposed a
separate evidence gap: whole-wardrobe image labels carried fabric and `reads_as` but omitted
authoritative wear mechanics. They now include tuck behavior, hem finish, waistband type, and a
required-base flag. The composer obeys these facts silently and writes `styling_instructions` only
for a useful action or chosen garment relationship—not to recite fixed garment truth to its owner.

**Architecture-review hardening, 2026-08-19.** A review of the complete flagged diff found real
boundary defects and several intentional shared-composer changes that this spec had not named:

- deterministic introductions now name the actual ready count, and shortfall grammar agrees with it;
- the direct router persists `established` context and `current_outfit_set` before returning, using
  the client thread ID, so follow-ups do not depend on browser-echoed cards;
- the deliberation sanitizer no longer treats ordinary “wait” or “must use” as hidden reasoning;
- named-location forecast failure stays neutral globally, while plan slots now disclose “forecast
  unavailable … temperature unknown” instead of describing neutral gates as a seasonal estimate;
- direct Visual Composer live home weather and shared wear-mechanics/renderer instructions are
  owner-approved global extensions, not accidental flag leakage;
- comparison-set diversity remains on freeform options, direct Visual Composer, and adjacent
  exploration, but is disabled for formula-similar saved-outfit variants;
- numeric weather remains model-judged inside the mild band. Evening/early-morning requests are
  judged toward the relevant cooler end, with a removable transit layer when supported; an indoor
  destination does not erase arrival/departure weather. Around a 55°F arrival/departure, a
  sleeveless vest over a light or short-sleeved base is not sufficient warmth: use sleeve-bearing
  outerwear, an actually warm long-sleeved base with an adequate layer, or disclose the wardrobe
  gap. This is guidance, not a new hard gate;
- a bounded whole-wardrobe batch cannot activate after a valid card already exists in the same
  turn, preventing the reachable hybrid run-3 shape from silently overwriting that earlier card.

Open follow-up concern: composite display-season strings still round-trip through thread memory.
Resolved weather physics should eventually travel independently so an aesthetic season token
cannot reclassify a mild live forecast on a follow-up that does not fetch weather again.

These corrections follow `thread_1787101448245`: correct city/none routing, live 70°F/55°F
weather, two model-authored `styling_instructions`, and a renderer that followed the second card's
layering mechanics. Its first card lacked a plausible 55°F evening layer.

## Acceptance

### Provider-free

1. The model-owned routing contract distinguishes one card, same-context batch, multi-context plan,
   current-card revision and text response.
2. `generate_outfits` receives the declared count and established activity/weather when arguments
   omit them.
3. A successful bounded batch locks further tools for the turn.
4. Parent diagnostics include the nested provider usage exactly once.
5. Fewer valid cards than requested do not trigger a paid general-loop retry.
6. With the feature flag off, router/tool-loop behavior is unchanged. Shared-composer contracts
   explicitly listed above remain global by owner ruling and are not flag-off equivalence claims.
7. Full `npm test`, text-matching ratchet and documentation health pass.
8. Multi-option diagnostics report distinct formula and silhouette counts, and flag a set only when
   both axes collapse; this is observability for the live quality review, not a taste gate.
9. The execution router receives no wardrobe manifest or garment rows.
10. The direct route returns only after `atomicMultiLookCompleted`; every other outcome reaches the
    full stylist.
11. Router and nested-composer token usage are both persisted exactly once.

### Paid live A/B — owner approval required before running

Use the same nature-walk prompt and wardrobe state as the $0.325 baseline. Compare total cost and
every usage component; outer iterations and nested provider calls; shown roster IDs and image count;
ratified hiking footwear; requested versus ready/needs-review cards; silhouette, hierarchy, print,
texture and lived wearability under owner review; and whether the closing prose describes every card.

One passing prompt is evidence for this request class, not permission to route every freeform turn
through the bounded composer.

## Later phases, separately measured

- bounded conversation history — implementation began 2026-08-19 behind
  bounded history (default-on since 2026-08-19, flag removed); it retains four recent exchanges while structured thread
  state carries current cards and resolved context (see `docs/freeform-followup-profiles-spec.md`);
- prompt/tool-schema deduplication with byte-level ownership of each instruction;
- smaller execution profiles for existing-card explanations and text-only answers — implementation
  began 2026-08-19 and is default-on (flag removed); the authoritative contract is
  `docs/freeform-followup-profiles-spec.md`;
- provider-native deferred tool loading if it reduces total cache cost;
- a smaller discovery manifest only after an owner ruling on wardrobe omniscience.
