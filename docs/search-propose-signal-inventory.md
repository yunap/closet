# Model-facing signal inventory — search/propose/generate/no-tool surfaces

**Status:** inventory complete, **no implementation**. Owner-requested 2026-09-03 after external review
of PR #315 traced the actual bad edit (thread_1788430055577's "Trail Walk & Rain Shell") to a turn that
never touched `plan_outfit_set` at all — `search_wardrobe → propose_outfit` produced it, with correct
68/48°F weather already present. This is the companion inventory to
[model-facing-signal-inventory.md](model-facing-signal-inventory.md), which covered only the plan path.
That document's finding — 19 of 25 signals were derived judgments, and the facts behind them were
absent from the payload — turns out to describe two thirds of the app's tool surface, not all of it.

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

Delegates to `generateOutfitsForPieceInternal`/`generateWholeWardrobeOutfitsVisualInternal` in
`routes/ai.js` rather than implementing its own candidate logic inline. Not traced line-by-line here —
stated honestly rather than assumed complete: given Surfaces 1–2 both reuse `weatherFitForPiece`/
`profileRuleFit` as shared primitives, and `automaticUsePool.js` (the eligibility gate all these flows
share) is a common dependency, the same scoring pattern is **likely but not confirmed** present.
Flagged as the one gap in this pass, to trace before implementation rather than assume.

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
| search_wardrobe | fabric/opacity/sleeve/etc. (untrimmed only); **no warmth/insulation ever** | `weatherFit`, `ruleFit` | 2 independent sorts by derived score |
| suggest_slot_swaps | via candidate piece rows | `weatherFit.score`, `ruleFit.tier` | additive scoring term, largest single weight |
| propose_outfit | none (pure id+role input) | none in schema; consumes shared Contract A/B/C on rejection | shared with plan path |
| generate_outfits | delegated, not traced | delegated, not traced | **unconfirmed — trace before implementing** |
| no-tool full-stylist | wardrobe manifest (F) | 6 lines of standing thermal policy in the system prompt | none (no tool = no scoring) but the strongest per-turn authority, since it applies with no per-turn facts to check it against |
| wardrobe manifest | 100% F | none | none |

## Target invariant, restated for this surface

Same as the plan-path rework: **deterministic code supplies garment truth, environmental truth, owner
constraints, and genuine hard feasibility constraints; the model owns styling judgment.** Applied here
that means, concretely:

- `search_wardrobe`'s result rows carry the same fact channel `plan_outfit_set` now does (warmth,
  insulation, interior construction, season, removability), not `weatherFit`/`ruleFit` labels.
- The two hidden sorts are replaced with the same range-preserving principle as
  `spreadThermalRange` — order should not itself be a delivered verdict.
- `suggest_slot_swaps`'s scoring drops the `weatherFit.score`/`ruleFit.tier` terms; ranking by
  mechanical diversity/newness/query-match stays, since those are not styling judgments.
- The tool description's "honour them" instruction is removed with the field it refers to.
- `stylistSystemTemplate` lines #11–13 are removed or rewritten to state facts and let the model reason
  ("this slot is indoor; heated buildings do not require outdoor warmth" rather than "do not serve
  sleeveless pieces").
- `propose_outfit`'s validator inherits whatever the plan-path adequacy rework eventually lands on
  (nothing new here — same functions).
- `generate_outfits` gets traced before any of the above ships, not assumed clean by similarity.

## Open, deliberately not folded in

- **Weather provenance** (`stated_user` meaning "the `userWeather` argument was populated" rather than
  "the human said so," found analyzing thread_1788430055577's turns 2–3). Real, confirmed, does not
  currently affect what the model receives (both turns resolved to the same 68/48°F either way). Not
  in scope for this conversion — flagged for whenever it's convenient, per the owner's explicit
  instruction not to mix it in unless the inventory showed a shared owner. It does not: provenance
  labeling lives in `weather.js`'s precedence resolver, unrelated to the judgment-vs-fact question this
  document addresses.
- `generate_outfits`' actual scoring path, not traced to the implementation (Surface 4).
- Whether `plan_outfit_set`'s own `piece_catalog` line (warmth/insulation/etc.) should simply be
  reused verbatim by `search_wardrobe` rather than building a second, parallel fact-line format — an
  implementation question, not part of this inventory.
