# Model-facing signal inventory — search/propose/generate/no-tool surfaces

**Status:** inventory complete; search/swap facts-not-judgments conversion implemented in `6ee24d8`.
Owner-requested 2026-09-03 after external review
of PR #315 traced the actual bad edit (thread_1788430055577's "Trail Walk & Rain Shell") to a turn that
never touched `plan_outfit_set` at all — `search_wardrobe → propose_outfit` produced it, with correct
68/48°F weather already present. This is the companion inventory to
[model-facing-signal-inventory.md](model-facing-signal-inventory.md), which covered only the plan path.
That document's finding — 19 of 25 signals were derived judgments, and the facts behind them were
absent from the payload — turns out to describe two thirds of the app's tool surface, not all of it.
**Amended 2026-09-06:** the document now distinguishes the original findings from the subsequently
implemented search/swap conversion, and Surface 4's previously explicit trace gap is closed. The
correction is recorded in place below and informs the narrower
[single-outfit weather-layer slice](single-outfit-weather-layer-vertical-slice-spec.md).
**Amended 2026-09-07 after live acceptance:** the fact channel no longer describes insulating face
material as generic constructed insulation, and weather-aware outerwear image allocation covers
distinct structured construction-evidence groups without reordering returned rows or adding a
thermal verdict.
**Amended again 2026-09-07:** a narrow proposal-validity exception now consumes the existing thermal
band: known undershoot is hard only for an explicitly required layer under a certain user-stated
encountered range. This is not a search rank or model-facing verdict. Router activity is also locked
as request authority so the model cannot lower demand by inventing exertion in a later tool call.
**Amended 2026-09-08:** complete `single_outfit` searches no longer use independent category/warmth
sampling. They return a complete compact eligible index and rich/image evidence for several atomic
whole-system paths selected from a structured construction frontier. The path metadata contains
shared mechanical/thermal dispositions, never an aesthetic verdict; all other search consumers retain
their existing result shape.

## Why this exists, precisely

The reviewer's own framing, confirmed here rather than assumed:

> Every time we add one more derived adequacy rule, the model becomes better at satisfying the engine
> and worse at dressing the person.

`plan_outfit_set` was reworked to facts-not-judgments (`02ffa84`, this session). `search_wardrobe`,
`propose_outfit`, `generate_outfits`, and the no-tool conversational surface were not touched, and each
was live-verified this session to still be carrying the old judgment contract — confirmed against real
wire captures for thread_1788430055577's turns 2 and 3, not retroactive recomputation:

```json
{"id":88,"name":"striped knit cardigan","category":"outerwear",
 "weatherFit":"well matched to the conditions","ruleFit":"preferred","ruleFitLabel":"preferred material"}
```

No warmth level, no insulation state, no interior construction. A pre-rendered adjective standing in
for the facts it was computed from — the exact defect the plan-path inventory diagnosed, now confirmed
live on the surface that actually produced the bad edit.

## Method

Read `styling-engine/tools.js` (3501 lines: `search_wardrobe`, `propose_outfit`, `generate_outfits`,
`suggest_slot_swaps` tool definitions and their `case` implementations), `styling-engine/prompts.js`
(the conversational system prompt, `stylistSystemTemplate`), and `styling-engine/rules.js`
(`weatherFitForPiece`, `profileRuleFit` — the two scoring functions everything below reads).
Cross-checked against the live wire capture for thread_1788430055577 where the capture existed.
Classification: **F** = factual evidence · **H** = hard constraint / owner authority ·
**J** = derived styling judgment.

## Surface 1 — `search_wardrobe`

### Serialized per-piece fields

| # | field | class | note |
|---|---|---|---|
| 1 | id, name, category | F | |
| 2 | `weatherFit` (label) | **J** | `weatherFitForPiece` — same underlying band as `thermalFitPieceAdvisory`, different vocabulary ("well matched to the conditions" vs "preferred") |
| 3 | `weatherFitScore` | **J** | untrimmed mode only; drives the hidden sort below |
| 4 | `ruleFit` / `ruleFitLabel` | **J** | `profileRuleFit` — occasion/activity/register/weather merged into one tier |
| 5 | reads_as, colors, occasions, pattern_*, silhouette, shoe_type, toe_shape | F | untrimmed mode only |
| 6 | fabric_category, fabric_weight, visual_weight, opacity, needs_base | F | untrimmed mode only |
| 7 | neckline, sleeve_length, sleeve_shape, length_hits_at, hem_finish, tuck_behavior | F | untrimmed mode only |
| 8 | weather_protection, walk_support, heel_height | F | untrimmed mode only |
| 9 | notes (120 chars) | F | |
| 10 | `retrieval` note (what broadened, shortfalls) | F | |

### Finding 1 — trimmed mode strips to almost pure judgment

When `toolContext.wardrobeManifestIncluded` is true (the common case — the manifest is in the cached
system-prompt prefix on most turns), the result collapses to:

```js
{ id, name, category, weatherFit, ruleFit, ruleFitLabel, notes }
```

Every fact in #5–9 above is dropped, on the stated rationale that the wardrobe manifest already carries
them (verified true — see Surface 6). But **no warmth level, no insulation state, no interior
construction ever appears in either mode**, trimmed or not — those are `garmentWarmthLevel` /
`thermalMaterialVerdict` / `interiorConstruction`, computed on the plan path and nowhere else. So even
the untrimmed shape cannot answer "how warm is this" except by fabric_weight alone — exactly the gap
that let the technical hoodie read as adequately warm on the plan path before that fact was added.
`search_wardrobe` never got that fix.

### Finding 2 — hidden shaping, two independent mechanisms

Confirmed by reading `case 'search_wardrobe'` line by line, not inferred:

- **Sort by weatherFitScore.** `results = results.map(...).sort((a,b) => b.weatherFitScore - a.weatherFitScore)`. A derived score decides *order*, exactly the pattern removed from `plan_outfit_set`'s `allowed_piece_ids` this session (a verdict delivered by position is harder to argue with than one stated in a field, not easier).
- **Sort by ruleFit tier, then by shoe support.** A second, independent sort keyed on `tierRank[ruleFit]` (preferred/neutral/discouraged/prohibited), stable-broken by `walk_support`. Two separate re-orderings compound before the model ever sees a list.
- **Hard exclusion at `ruleFit === 'prohibited'`.** This one is legitimate — `prohibited` is meant as a hard tier (parallel to the plan path's `extreme_heat` `prohibited`). Correctly excluded outright in `compose` mode, correctly retained-and-annotated in `explain` mode.

### Tool description text instructing obedience

> "Each result carries a weatherFit and a ruleFit tier: **honour them**. Use weatherFit to keep heavy
> fabrics off hot daytime looks and reserve heavier pieces for cool-evening layers."

Same shape as the plan path's pre-rework instruction block (removed in `02ffa84`) — the tool
description itself teaches obedience to a verdict, on the surface that still emits one.

### Implemented after this inventory (`6ee24d8`)

The findings above describe the captured 2026-09-03 behavior. The current `search_wardrobe` branch
has since removed `weatherFit`/`weatherFitScore`, the thermal-score sort, and the tool instruction to
obey that verdict. It now emits `thermalFactsForPieceLine` in both trimmed and full result shapes and
keeps retrieval order until the separate occasion/activity `ruleFit` ordering. That remaining tier is
not a thermal verdict; its hard `prohibited` behavior and soft tier ordering are unchanged and remain
owned by occasion/activity policy.

## Surface 2 — `suggest_slot_swaps`

Not in the original scope, found while tracing `search_wardrobe`'s scoring pattern. Live in
`weatherFitForPiece`/`profileRuleFit` calls inside the tool's own candidate-ranking block:

```js
score: newnessScore + occasionScore + queryScore + colorScore
     + (weatherFit.score || 0) - ((tierRank[ruleFit.tier] ?? 1) * 8)
```

**J** — a derived thermal/rule score is a direct additive term in candidate ranking, weighted more
heavily than any single factual term (color/occasion/query bonuses are 12 or less; the rule-tier
penalty alone is up to 24). Confirms the reviewer's "hidden hidden shaping" concern is not
`search_wardrobe`-specific — it is the same two functions (`weatherFitForPiece`, `profileRuleFit`)
reused as a scoring primitive across at least two tool implementations, likely more (see Surface 3).

**Implemented after this inventory (`6ee24d8`):** the current swap score no longer contains
`weatherFit.score`, and the returned debug record carries `thermalFactsForPieceLine` instead of a
`weatherFit` label. Newness, query/color match, occasion fit, and the separately owned `ruleFit` term
remain.

## Surface 3 — `propose_outfit`

The tool's own input schema carries **no per-piece judgment fields at all** — it accepts `{id, role,
anchor}`, nothing else. The judgment already happened upstream, in whichever `search_wardrobe` call
supplied the IDs; `propose_outfit` itself is a pure structural/validation surface. Its
`case 'propose_outfit'` implementation calls `evaluateWearableOutfit(resolved, { weatherContext: ...
})`, which composes Contract A/B/C — **the same machinery already classified in
[model-facing-signal-inventory.md](model-facing-signal-inventory.md)**: `NO_WARM_LAYER_FOR_COLD` (H),
`NO_REMOVABLE_COOL_LAYER*` (J, per that document's own finding), `THERMAL_UNDERSHOOT`/`OVERSHOOT` (J,
advisory). Not re-classified here — same functions, same verdicts, shared with the plan path. The
practical implication: **fixing `outfitEnvironmentalAdequacy.js`'s model-facing text once fixes both
surfaces**, since `propose_outfit` and `submit_plan_outfits` both route through it.

## Surface 4 — `generate_outfits`

**Amended 2026-09-06 — traced, correcting the earlier unconfirmed entry.** `executeTool` delegates to
`generateOutfitsForPieceInternal` or `generateWholeWardrobeOutfitsVisualInternal` in `routes/ai.js`.
The whole-wardrobe branch is not the same candidate contract as `search_wardrobe`:

- `declareBoundedMultiLookIntent` treats a fresh request as bounded only when its count is at least
  two. Although the tool description permits an explicit one/best request to call
  `generate_outfits(limit: 1)`, that call is therefore outside the bounded profile.
- The nested whole-wardrobe call receives the turn's `resolvedWeatherProfile` only in the bounded
  profile. Its call site does not forward `user_weather`, `location`, or `date`. A one-look call can
  consequently discard the just-resolved explicit weather and let the nested composer resolve a
  different context. `freeform_observability.test.js` currently asserts this distinction.
- `generateWholeWardrobeOutfitsVisualInternal` applies deterministic candidate gates and shaping,
  then gives the composer candidate images labeled by `composerPieceLineSuffix`. That suffix includes
  fabric category, opacity, fit, and wear-mechanics facts, but not `thermalFactsForPieceLine`'s warmth,
  insulation, interior construction, season, or removability channel.
- The final returned proposals do pass through `locallyGateWholeWardrobeOutfits` with the resolved
  weather, so this is not “no validation.” The problem is that candidate shaping and model judgment
  do not share the serial path's newer facts-not-judgments contract, and the one-look alternate route
  can start with the wrong weather identity.

The first corrective slice therefore does not redesign the batch composer. It makes one fresh outfit
unambiguously `search_wardrobe → propose_outfit` and reserves `generate_outfits` for a 2–5 look batch.
The batch composer's model-facing thermal fact channel remains a separate follow-up.

## Surface 5 — no-tool full-stylist responses

The reviewer's point 3, confirmed and more significant than expected: model-facing thermal **policy**,
not just per-turn verdicts, is authored directly into `stylistSystemTemplate`
(`styling-engine/prompts.js`), the main conversational system prompt present on every turn regardless
of which tools fire.

| # | text (paraphrased/quoted) | class | note |
|---|---|---|---|
| 11 | "treat `discouraged` pieces as legitimate judgment calls... favor `preferred`" | **J** | direct instruction to obey Surface 1's tiers, independent of any single tool call |
| 12 | "choose alternatives whose `ruleFit` and `weatherFit` still support that register" | **J** | same |
| 13 | "INDOOR slots are climate-controlled... do not serve sleeveless, breezy, or beachy pieces as if [they]'ll be outside" | **J** | a standing rule equating indoor with "no sleeveless," authored once, applied every turn — not derived from that turn's actual facts |
| 14 | "an office in a July heatwave is still air-conditioned... offices often run cool, if anything" | **F**-leaning | this one is closer to a factual claim about offices than a styling verdict; kept separate from #13 rather than merged |
| 15 | "Do not drift back to warm-weather or generic beach assumptions" (context persistence) | H-leaning | continuity enforcement, not a thermal verdict per se — arguably legitimate (don't forget established facts) rather than judgment being smuggled in |
| 16 | "Layering Logic & No Double-Vests" — what counts as a valid layer category | H | structural/definitional, not thermal — kept separate |

This is the finding the reviewer was right to ask for by name: **turn 5 of thread_1788430055577 made a
direct thermal judgment ("you would freeze... proper sleeves or a substantial knit") with zero tool
calls** (`toolSequence` empty, `searchCalls: 0`, confirmed in the corrected capture). That is not
evidence of a leak *from* a tool — it is evidence that the system prompt itself carries thermal
authority independent of any tool surface. #11–13 are the load-bearing lines: they instruct the model to
defer to verdicts it may not have even asked for this turn, and to apply a blanket indoor/sleeveless
rule regardless of that turn's actual resolved conditions.

## Surface 6 — the wardrobe manifest (for contrast)

Read in full (`buildWardrobeManifestLine`, `src/utils/wardrobeAiContext.js`). **Entirely F-class**:
color, fabric_category/weight, opacity, needs_base, silhouette, shoe_type, toe_shape, length, neckline,
sleeves. No warmth level, no insulation verdict, no weatherFit/ruleFit. This is the one surface in the
whole non-plan contract that already matches the target shape — cited as the existing example to build
the others toward, not something to change.

## Cross-surface summary

| surface | fact channel | judgment channel | hidden shaping |
|---|---|---|---|
| plan_outfit_set (reworked) | `warmth:`/`insulation:`/`season:`/`removable:` per piece | none (removed 02ffa84) | `spreadThermalRange` — range, not rank |
| search_wardrobe | source-specific thermal fact line in both shapes; broader garment facts in untrimmed shape | `ruleFit` for occasion/activity, not thermal fit | occasion/activity tier ordering; no thermal sort; weather-aware outerwear image slots spread across structured construction evidence |
| suggest_slot_swaps | thermal fact line in returned debug record | `ruleFit.tier`; no thermal verdict (`6ee24d8`) | newness/query/color/occasion plus `ruleFit`; no thermal score |
| propose_outfit | none (pure id+role input) | none in schema; consumes shared Contract A/B/C on rejection | shared with plan path |
| generate_outfits | deterministic roster facts, but composer labels omit warmth/insulation/interior/season/removability | weather-shaped candidate pool plus final shared validation | traced: alternate `limit:1` route can lose canonical weather; batch composer uses its own shaping |
| no-tool full-stylist | wardrobe manifest (F) | 6 lines of standing thermal policy in the system prompt | none (no tool = no scoring) but the strongest per-turn authority, since it applies with no per-turn facts to check it against |
| wardrobe manifest | 100% F | none | none |

## Target invariant, restated for this surface

Same as the plan-path rework: **deterministic code supplies garment truth, environmental truth, owner
constraints, and genuine hard feasibility constraints; the model owns styling judgment.** Applied here
that means, concretely:

- **Implemented in `6ee24d8`:** `search_wardrobe`'s result rows carry the shared thermal fact channel
  (warmth, insulation, interior construction, season, removability), not a `weatherFit` label, and no
  longer sort by a thermal score. Separately owned occasion/activity `ruleFit` remains.
- **Implemented 2026-09-07 after live acceptance:** the shared line distinguishes a recorded
  `insulating layer` from `insulating face material`; weather-aware outerwear photographs cover
  constructed, filled, unfilled, and unknown evidence rather than the first same-shaped rows. The
  returned roster remains in its existing order and receives no weather-fit label.
- **Implemented 2026-09-08 for complete one-outfit searches:** `buildSystemAwareWeatherRoster`
  preserves the full hard-eligible compact index, validates complete paths through shared owners,
  and chooses an atomic photo union by thermal disposition, distance, factual construction coverage,
  and stable order. The model chooses what looks good; a targeted `view_pieces` alternative remains
  available, so the visual subset cannot be narrated as the whole wardrobe.
- **Implemented in `6ee24d8`:** `suggest_slot_swaps` drops `weatherFit.score` while retaining
  newness/query/color/occasion and `ruleFit` behavior; its debug result now exposes thermal facts.
- **Implemented in `6ee24d8`:** the tool description's thermal "honour them" instruction is removed
  with the field it referred to.
- `stylistSystemTemplate` lines #11–13 are removed or rewritten to state facts and let the model reason
  ("this slot is indoor; heated buildings do not require outdoor warmth" rather than "do not serve
  sleeveless pieces").
- `propose_outfit`'s validator inherits whatever the plan-path adequacy rework eventually lands on
  (nothing new here — same functions).
- `generate_outfits` is reserved for 2–5 fresh same-context looks; a one-outfit request uses the
  serial search/propose contract. Adding the batch composer's missing thermal fact channel remains a
  separate implementation decision.

## Open, deliberately not folded in

- **Weather provenance** (`stated_user` meaning "the `userWeather` argument was populated" rather than
  "the human said so," found analyzing thread_1788430055577's turns 2–3). Real, confirmed, does not
  currently affect what the model receives (both turns resolved to the same 68/48°F either way). Not
  in scope for this conversion — flagged for whenever it's convenient, per the owner's explicit
  instruction not to mix it in unless the inventory showed a shared owner. It does not: provenance
  labeling lives in `weather.js`'s precedence resolver, unrelated to the judgment-vs-fact question this
  document addresses.
- The batch composer's model-facing thermal fact channel and weather-shaped candidate pool. Surface 4
  is now traced, but redesigning that path is deliberately separate from the single-outfit slice.
- Whether the batch composer should reuse the same `thermalFactsForPieceLine` now shared by the plan,
  search, and swap paths rather than maintain its separate `composerPieceLineSuffix` format.
