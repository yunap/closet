# Spec — outerwear weather capability (`outerwear_role`, `weather_protection`)

**Status:** ratified, implementation in progress
**Last verified:** 2026-08-22 — amended to add `weather_protection` before the first tagging pass

Route: [docs/README.md](README.md). Sources this spec must not restate:
[weather-fit-graded-evidence-model — see git log around PRs #243/#244](engine-behaviour-map.md)
for the thermal model this deliberately does not touch, and
[garment-field-reference.md](garment-field-reference.md) for the general tagged-field wiring
convention this follows.

**Amendment, 2026-08-22:** `outerwear_role` alone conflates "how this layer generally functions"
with "what specific weather hazard it protects against" — a windbreaker and a raincoat are both
`protective_shell`, but they are not interchangeable. Caught before the first real tagging pass
(§10 below), so `weather_protection` ships alongside `outerwear_role` in the same tagger change
rather than as a second retag later.

---

## 1. What this adds, and why it's a separate axis from #244

PRs #243/#244 gave the app a graded thermal model — `pieceWeatherEvidence`/`pieceWeatherScores`
in `styling-engine/rules.js` — that answers *how warm or cool does this garment run*. Outerwear
has two further, independent properties that thermal scoring alone cannot answer: **what weather
function can this outer layer perform** (`outerwear_role`), and **which specific hazard, if any,
it reliably protects against** (`weather_protection`).

A light windbreaker and a light cardigan can carry similar thermal scores while being completely
different tools outdoors — one blocks wind and rain, the other does neither. A heavy wool
cardigan can be warm without functioning like a winter coat. And within `protective_shell` itself,
a windbreaker and a raincoat are not interchangeable even though both carry the same role. Thermal
weight, outdoor function, and hazard-specific protection are three different physical facts about
the same garment, and #244's own design charter (no single tag is sufficient on its own) argues
for keeping them as separate evidence rather than inferring one from another.

This spec adds two new fields, `outerwear_role` and `weather_protection`, that capture outdoor
function and hazard-specific protection. Neither touches, replaces, or feeds into
`pieceWeatherScores()`.

## 2. The `outerwear_role` field

```text
outerwear_role: indoor_layer | transition_layer | protective_shell | cold_weather_outerwear
```

- Applies only to `category: outerwear`. Null for every other category.
- **Strictly validated** — normalized through `taggerMerge.js`'s `normalizeEnumValue()` against a
  `VALID_OUTERWEAR_ROLE` `Set`, the same tier as `formality`/`bottom_subtype`/`heel_height`. A
  value outside the four is silently nulled on save, per the field-reference doc's own warning
  about that failure mode — chosen deliberately here because this field is meant to gate real
  engine decisions eventually (see §6), the same reason `formality` gets strict validation and a
  loosely-validated field like `reads_as` doesn't.
- Functional, not stylistic and not thermal. `cardigan`/`blazer`/`vest`/`jacket`/`coat` remain
  garment-kind information (`silhouette`, `fabric_category`, etc.); `pieceWeatherScores()` remains
  the shared thermal model; `outerwear_role` answers only "what job can this garment do outdoors."

### Meaning of the four values

| Value | Meaning | Examples |
|---|---|---|
| `indoor_layer` | Modest warmth/styling/indoor-temperature layer; no meaningful outdoor weather protection assumed. | Fine cardigan, knit shrug, lightweight fashion cardigan, soft indoor jacket. |
| `transition_layer` | Works as the primary outer layer in mild/cool transitional conditions; not a true weather shell or winter coat. | Substantial cardigan, denim jacket, utility jacket, medium casual jacket, some blazers, some vests. |
| `protective_shell` | Built primarily to block wind/rain/exposure rather than insulate. May be thermally light — that does not promote it to `cold_weather_outerwear`. | Windbreaker, rain shell, lightweight weatherproof jacket. |
| `cold_weather_outerwear` | Genuine cold-weather outer layer providing substantial insulation as the outside layer. | Insulated winter coat, substantial wool coat, puffer, down coat. |

### What must NOT be inferred

None of the following is sufficient on its own to assign a role — each can be supporting evidence,
never a categorical conclusion:

```text
heavy fabric      → cold_weather_outerwear
wool              → cold_weather_outerwear
nylon/polyester   → protective_shell
"coat" in name    → cold_weather_outerwear
"jacket" in name  → transition_layer
"cardigan" in name → indoor_layer
```

A heavy wool cardigan can still be an indoor/transition layer. A nylon fashion jacket is not
necessarily a protective shell. A lightweight windbreaker can be a protective shell with very
little insulation. Same principle as #244: derive functional meaning from the combination of
available evidence, not from one tag standing in for the judgment.

### Vests

A vest is not treated as solving full-body cold exposure merely because its material is warm or
its role is `transition_layer`/`cold_weather_outerwear` — it can supply torso insulation while
leaving arm exposure unresolved. That stays a composition-level consideration read from existing
sleeve/coverage signals, not a special vest role. No change to how vests are handled today.

## 3. The `weather_protection` field

```text
weather_protection: array, values from [rain, wind]  (e.g. [], ["wind"], ["rain","wind"])
```

- Applies only to `category: outerwear`. Empty array for every other category.
- **Multi-select, strictly validated.** Normalized through a new `normalizeWeatherProtection()` in
  `taggerMerge.js` against a `VALID_WEATHER_PROTECTION` `Set` (`rain`, `wind`) — any value outside
  that set is dropped, not nulled-whole, the same shape as `normalizeFiberContent` but without its
  `unknown` fallback: **unset/empty means no reliable protection capability identified, not "worth
  a placeholder."** An empty array is a legitimate, common answer (an ordinary denim jacket has
  neither).
- This is deliberately narrower than a general "weatherproofing" tag. Only the two hazards this
  wardrobe is already known to need are in scope — see §9. No `waterproof`/`water-resistant`/
  breathability *rating* fields in this pass: the photos and existing structured metadata cannot
  reliably support a rating, only a binary presence/absence read on construction intent.
- Independent of `outerwear_role`. A `protective_shell` piece is not assumed to carry both values —
  a windbreaker is `["wind"]`, a raincoat is `["rain"]`, a genuine rain/wind shell is
  `["rain","wind"]`. A `transition_layer` or `cold_weather_outerwear` piece can still legitimately
  carry a value (a wool coat with a tight enough weave to read as wind-resistant), but only when
  the garment's own construction evidence actually supports it — see the next section.

### What must NOT be inferred

Same discipline as `outerwear_role` — material or category alone does not establish a hazard
capability:

```text
nylon/polyester        → rain protection
heavy fabric/fabric_weight → wind protection
"shell"/"parka" in name → either value automatically
protective_shell role   → both rain AND wind by default
```

A nylon fashion jacket is not automatically rain-protective — nylon is a fiber, not a construction
claim about sealed seams or a coated face. Fabric weight describes thermal mass, not wind
resistance — a heavy wool coat is not wind-protective merely for being heavy; it only earns `wind`
when the garment's own visible construction (tight, dense weave; a face fabric read as
wind-resistant; a genuinely close, wind-blocking cut) supports that specific claim, the same
"purpose-built design can establish function where a tag is weak or missing; the material name
alone cannot" evidence-provenance rule already stated for the stylist prompt
(`styling-engine/prompts.js`'s EVIDENCE PROVENANCE block) and now extended to the tagger.
`protective_shell` role does not default to either hazard value — a shell built for rain is not
assumed windproof, and vice versa, unless both are independently supported.

## 4. Tagging

- The tagger (`tagPiecePromptTemplate` in `styling-engine/prompts.js`) assigns both
  `outerwear_role` and `weather_protection` for outerwear pieces from the image plus existing
  structured metadata (construction/intended function), the same way it judges `tuck_behavior` or
  `fit_on_body`. Both fields are tagged in the same pass — no separate retag needed for the second
  field.
- **Leave unset when evidence is insufficient — never guess.** Same rule as every other tagged
  field with a "do not guess" clause (`needs_base`, `stretch`). For `weather_protection`
  specifically, "leave unset" means the empty array, not omitting the field.
- Manually editable, same as every other tagged field.
- No separate `waterproof`/`water-resistant`/breathability *rating* fields in this pass —
  `weather_protection`'s two binary values are the initial granularity.

## 5. Shared readers

```js
export function pieceOuterwearRole(piece = {})
export function pieceWeatherProtection(piece = {})
```

Both live in `styling-engine/attributes.js` next to `pieceWarmthTier`/`pieceBareness`.
`pieceOuterwearRole` returns the normalized value for `category: outerwear` pieces, `null`
otherwise (wrong category, unset, or an unrecognized stored value — defensive against any
pre-normalization data). `pieceWeatherProtection` returns the normalized array (`rain`/`wind`
subset) for `category: outerwear` pieces, `[]` otherwise. All future engine consumers read through
these rather than touching `piece.outerwear_role`/`piece.weather_protection` directly, so a later
consumer never has to re-derive the category guard or re-litigate normalization.

Unknown/unset is a no-op wherever it's read — never a rejection.

## 6. Explicit non-goals for this pass

These are the scope boundaries a coder should not cross without a new spec:

1. **Does not touch `pieceWeatherScores()` / `pieceWeatherEvidence()`.** Thermal, outdoor
   function, and hazard protection stay separate evidence, combined only at decision time by a
   future consumer.
2. **Does not touch `pieceHeatSuitability()` or the Wardrobe "Weather fit" filter.** That filter
   describes thermal fit; a shell's usefulness in rain/wind is a different dimension the filter
   isn't scoped to answer. The stylist/composer can combine the two when live weather context
   requires an outer layer — not built here.
3. **No Wardrobe browse filter for either field.** Their purpose this pass is engine correctness
   and tagging-accuracy QA, not a new user-facing filter chip.
4. **No weather-profile hardcoding** (e.g. "below 50°F → require `transition_layer`", "rain in
   forecast → require `weather_protection` includes `rain`"). The garment stays described by its
   own intrinsic properties; calibrating which capability a given forecast actually needs is
   future work, deliberately deferred so thresholds can be tuned later without retagging.
5. **No new all-purpose `weather_suitability` tag, and no rating fields.** #244 owns thermal
   behavior; `outerwear_role` adds the outerwear-function axis; `weather_protection` adds
   hazard-specific presence/absence only — not a `waterproof`/`water-resistant`/breathability
   *rating*, which the available evidence (photos + existing structured metadata) cannot support
   reliably. Garment type, thermal behavior, coverage, function, and hazard protection stay
   separate fields, combined at decision time by whatever reads them.

## 7. UI, this pass

- **Visible and manually editable in the garment editor (`PieceForm.jsx`) for outerwear pieces,
  beside `outerwear_role`.** This is deliberate and is the actual point of this first pass: with
  no engine consumer yet, the only way to QA tagger accuracy against real wardrobe data is to have
  both values visible and correctable on the piece itself. Also wired into `BatchAdd.jsx`'s review
  step for the same reason — a batch-tagged piece needs the same visibility the single-piece
  editor gets. Standard tag-suggestion highlighting (the "Review suggested" affordance every other
  tagged field gets) applies to both. Neither is treated as gate-critical (`GATE_CRITICAL_FIELDS`)
  — nothing gates on either yet.
- A short help affordance (ⓘ) sits next to the "Outerwear role" label in the editor, deliberately
  brief — states the four values and "function, not warmth," not the full spec rationale.
- **No Wardrobe browse filter** — see §6.3.

## 8. A known future consumer, explicitly out of scope here

> **Update, 2026-08-31.** That follow-up is now specified in
> [outerwear-weather-consolidation-spec.md](outerwear-weather-consolidation-spec.md), which
> honours this section's sequencing: its Slice A.1 is a mandatory real-wardrobe tagging audit
> with a stop condition, and the truth-surface exposure deferred in §10 below lands there as
> Slice E, alongside the first consumer.

`styling-engine/outfitSetPlanner.js` already hand-writes prose that draws roughly the
`outerwear_role` distinction, twice, without any structured backing:

> *"A sleeveless top must include a medium/heavy cardigan that stays on indoors; a coat or puffer
> does not satisfy the indoor-layer requirement."* (~line 3551, and a near-duplicate ~line 3999
> for the winter-indoor-sleeveless-base case)

Today the model is trusted to infer "cardigan" vs. "coat or puffer" from garment names/photos
alone, with no structured field behind the distinction. Once `outerwear_role` (and, for a live
forecast that names rain or wind specifically, `weather_protection`) exists and has real tagged
data, wiring that requirement text (or the underlying gate) to read `pieceOuterwearRole()`/
`pieceWeatherProtection()` instead of trusting name-based inference is the obvious next step —
**but it is not part of this pass.** Ship both fields, get them tagged and manually QA'd against
the real wardrobe first; wire a consumer in a follow-up once there's real data to validate
against.

## 9. Regression fixtures to pin once the tagger change ships

`outerwear_role`:

1. Lightweight cardigan → `indoor_layer`
2. Heavy wool cardigan → not automatically `cold_weather_outerwear`
3. Light windbreaker → `protective_shell`
4. Ordinary medium jacket → plausible `transition_layer`
5. Substantial wool winter coat → `cold_weather_outerwear`
6. Vest → role may indicate useful outerwear, but arm exposure remains unresolved (no change to
   existing vest handling)
7. Heavy blazer → not automatically `cold_weather_outerwear`
8. Nylon/polyester fashion jacket → not automatically `protective_shell`

`weather_protection`:

9. Windbreaker → `["wind"]`, not `["rain","wind"]` by default
10. Raincoat → `["rain"]`, not `["rain","wind"]` by default
11. A genuine rain/wind shell (both hazards visibly/constructionally supported) → `["rain","wind"]`
12. Ordinary denim jacket → `[]` — `transition_layer` role does not imply any protection value
13. Wool coat → `[]` unless the garment's own construction genuinely supports `wind`; never
    inferred from wool or fabric weight alone
14. Nylon/polyester fashion jacket → `[]` — nylon alone does not establish `rain`

## 10. Implementation footprint

New tagged fields touch a known set of places in this codebase (see the piece-persistence note in
`docs/garment-field-reference.md`'s "How safe is it to extend an enum" section for why — piece
persistence flows through the frontend form, and unknown fields are silently dropped on save).
Both fields land together in one pass, in the same set of files:

1. `styling-engine/prompts.js` — `tagPiecePromptTemplate` schema lines + guidance, for both fields
2. `routes/ai.js` — `/extract-pieces` inline JSON schema (the duplicate schema for the intake
   flow), plus the `/tag-piece` post-parse normalization, for both fields
3. `db.js` — `NEW_COLUMNS` migration for both columns, plus `parsePiece` array-parsing for
   `weather_protection` (matching `fiber_content`'s `safeJsonParse(..., [])` pattern)
4. `routes/crud.js` — POST + PUT `/pieces` (destructure, column list, placeholder count, run args)
   for both fields
5. `styling-engine/taggerMerge.js` — `VALID_OUTERWEAR_ROLE`/`normalizeOuterwearRole()` and
   `VALID_WEATHER_PROTECTION`/`normalizeWeatherProtection()`, both added to `CONFIDENCE_FIELDS`,
   and both added to the `applyTaggerResult` patch normalization
6. `styling-engine/attributes.js` — the `pieceOuterwearRole()` and `pieceWeatherProtection()`
   shared readers
7. `src/components/PieceForm.jsx` — initial form state, the AI-tag-apply path, and controls for
   both fields gated on `category === 'outerwear'` (a `ChipRow` single-select for `outerwear_role`
   with its ⓘ help text, a `ChipRow multi` for `weather_protection`)
8. `src/components/BatchAdd.jsx` — `emptyForm`, tags→form mapping, and review-step controls for
   both fields

Truth-surface exposure (the wardrobe manifest / `search_wardrobe` result object /
`buildWardrobePieceTruthText`) is deliberately **not** wired this pass — nothing reads either
field yet, and the garment editor already satisfies the "QA against real data" goal on its own.
Add it alongside whatever consumer eventually reads `pieceOuterwearRole()`/
`pieceWeatherProtection()`, so the truth surface and its first real reader land together.
