# Spec — consolidate outerwear weather capability into existing garment/weather ownership

**Status:** Proposed — amended 2026-08-31 after independent review. Slice A and Slice A.1 are
complete (Appendix A). Both blocking owner rulings were given 2026-08-31 and executed — the
data-quality precondition **passes** (Appendix B). Slices B through E are implemented
(Appendices C, D and E); **Slice F is next.**
**Route:** [docs/README.md](README.md).
**Scope:** Architecture-remediation extension to the completed ownership-consolidation arc.
**Predecessors, both ratified, neither reopened here:**
[outerwear-weather-capability-spec.md](outerwear-weather-capability-spec.md) (the fields),
[cold-severity-spec.md](cold-severity-spec.md) (`isCold` vs `isColdSevere`),
[architecture-responsibility-census.md](architecture-responsibility-census.md) (ownership vocabulary).

**Primary goal:** make existing outerwear capability facts participate in the same shared weather
eligibility and outfit-validation contracts already used across Closet, without creating another
weather engine, another flow-specific gate, or additional user-entered garment physics.

> **Amendment note.** Sections marked **[A1]**–**[A7]** were added or rewritten on 2026-08-31 in
> response to an independent review of the first draft. Sections marked **[R1]**–**[R3]** are
> findings from that review that were verified against the code and are prerequisites, not
> observations. The first draft is superseded in place; there is no v2 to reconcile.

---

## 1. Problem

Closet already stores two structured outerwear capability fields:

```text
outerwear_role:
- indoor_layer
- transition_layer
- protective_shell
- cold_weather_outerwear

weather_protection:
- rain
- wind
```

Canonical readers already exist in `styling-engine/attributes.js`:

```text
pieceOuterwearRole()      (attributes.js:182)
pieceWeatherProtection()  (attributes.js:193)
```

The thermal model is separately established through garment facts including `fabric_weight`,
insulating material, coverage and bareness, owned by `pieceWeatherScores()` /
`weatherFitForPiece()` (`styling-engine/rules.js:287`, `:343`).

Today these systems are disconnected. `outerwear_role` and `weather_protection` are populated
garment facts with **zero engine consumers** — they appear only in the tagger, persistence, the
garment editor, and their own unit tests.

### Current failure

1. The engine can know that a piece is an `indoor_layer` but still accept it as the outfit's
   cold-weather outerwear.
2. A cold-weather validation branch treats the presence of essentially any outerwear as satisfying
   a warm-layer requirement — literally `Boolean(layer)`, `styling-engine/outfitSetPlanner.js:3947`.
3. Cold indoor transit has a stricter sleeve-bearing/removable-layer requirement
   (`outfitSetPlanner.js:3956`), but still does not determine whether the layer is actually
   appropriate outdoor outerwear.
4. The stylist model has to infer outerwear function from garment name, appearance, fabric and
   general knowledge instead of receiving the structured capability facts Closet already owns.
5. Capsule code contains local heuristics such as "medium/heavy cardigan"
   (`outfitSetPlanner.js:4111`, prose twin at `:3659`) that partly reconstruct semantic information
   represented by `outerwear_role`.

### **[A5]** On the missing model projection — deferral, not oversight

Model projection was **deliberately deferred with the consumer**.
[outerwear-weather-capability-spec.md](outerwear-weather-capability-spec.md) §10 ratified that the
truth surface (wardrobe manifest / `search_wardrobe` result object / `buildWardrobePieceTruthText`)
lands *alongside* the first real reader, so the fields and their first consumer are validated
together. This slice **executes that deferred step**; it does not correct an omission. Once the
data-quality precondition (§15, Slice A.1) passes and the first runtime consumer exists, expose the
canonical facts to the stylist through the established garment-truth projection paths.

---

## 2. Architectural ruling

This work MUST extend the existing consolidation architecture. Do not create:

* a standalone outerwear weather engine;
* a second pool evaluator;
* a freeform-only outerwear gate;
* capsule-specific outerwear semantics;
* prompt-only weather rules that code does not own;
* a new role-temperature table;
* another large `weatherFit` implementation parallel to the existing one.

Use the established ownership chain:

```text
stored garment fields
    ↓
attributes.js normalized fact readers
    ↓
shared narrow weather/capability verdict primitives
    ↓
existing shared eligibility / wearable-outfit validation
    ↓
flow-specific strategy and disposition
    ↓
model/tool/UI projections
```

The semantic meaning must be shared. Search, proposal, whole-wardrobe generation, plan, capsule and
recovery may respond differently to the same finding, but they may not independently reinterpret
the garment capability. The census already names the anti-pattern this protects against: *"Parallel
weather/register/activity/owner gates"* ([architecture-responsibility-census.md](architecture-responsibility-census.md),
Eligibility row).

---

## 3. Semantic contracts

Do not collapse all weather reasoning into one boolean. There are three separate questions.

### Contract A — thermal suitability

How much useful thermal insulation/coverage does this garment contribute in the resolved weather?

Existing owner: `pieceWeatherScores()` / `weatherFitForPiece()`. Inputs already include fabric
weight, fiber/material insulation, sleeve/coverage, garment cut/bareness. **This work must reuse
that owner. `outerwear_role` MUST NOT replace thermal interpretation.**

```text
cashmere cardigan     → outerwear_role = indoor_layer,      thermal contribution = substantial
thin waterproof shell → outerwear_role = protective_shell,  thermal contribution = light
```

Both facts are simultaneously true.

### Contract B — outerwear functional capability

What environmental job can this outerwear piece legitimately perform?

This is the missing shared verdict. It consumes, rather than redefines: `pieceOuterwearRole()`,
`pieceWeatherProtection()`, existing thermal/weather evidence, structured garment construction
facts, resolved weather/exposure context.

It returns structured findings/evidence, not a free-text stylist verdict:

```js
{
  verdict: 'pass' | 'insufficient' | 'unknown',
  findings: [ { code, dimension, reason, evidence } ]
}
```

Exact naming is implementation-owned; semantic shape is not.

### Contract C — outfit environmental adequacy

Taken together, does this outfit provide the required coverage, warmth and environmental protection
for this context?

This belongs in the existing shared wearable/outfit validation architecture and composes Contracts
A and B. Do not invent an independent `validateWeatherOutfit` pipeline beside
`evaluateWearableOutfit`.

**[O2] Owner ruling, 2026-08-31 — where Contract C lives.** `evaluateWearableOutfit()` becomes the
canonical outfit-validity **aggregator** with optional resolved context, but **weather semantics do
not go inside that function**. A narrow shared outfit-level verdict primitive owns them,
conceptually:

```text
evaluateOutfitEnvironmentalAdequacy(pieces, resolvedContext)
```

`evaluateWearableOutfit()` composes its findings when authoritative context is supplied. Binding
constraints:

* the environmental verdict consumes the **canonical resolved `weatherProfile` / context only** — it
  must never parse weather prose, location, or dates itself;
* `isColdSevere` belongs to **this outfit-level verdict**, not to the per-piece capability
  primitive. Contract B stays evidence-only; Contract C decides whether the complete system is
  adequate;
* existing context-free callers of `evaluateWearableOutfit()` remain unchanged initially;
* **do not manufacture weather context locally** anywhere to satisfy the new stage.

---

## 4. Meaning of `outerwear_role`

Do not assign fixed temperature thresholds to these values. The values answer *what kind of job the
garment performs*; the existing weather/thermal model determines whether the garment or layering
system is adequate for the actual temperature.

**`indoor_layer`** — a garment intended to provide wearable layering that may remain on indoors.

* contributes its real thermal value;
* may be worn outdoors;
* MUST NOT, solely by being category `outerwear`, satisfy a requirement for genuine cold-weather
  outdoor outerwear;
* may participate beneath another outer layer.

Do not encode "cardigan = indoor layer" in consumers. Use the tagged role where available.

**`transition_layer`** — a genuine outer layer for mild/cool transitional outdoor use.

* can satisfy an outdoor-layer requirement when the existing thermal assessment says the resulting
  outfit is appropriate;
* MUST NOT mean a hard Fahrenheit/Celsius range;
* does not automatically qualify as cold-weather outerwear merely because it has sleeves.

**`protective_shell`** — an outer layer whose main job is environmental barrier protection rather
than insulation.

* does not imply warmth;
* does not by itself imply `rain`;
* does not by itself imply `wind`;
* combines with `weather_protection` to state actual supported hazards;
* may need insulating layers underneath in cold conditions.

**`cold_weather_outerwear`** — a garment constructed as genuine cold-weather outerwear.

* provides strong evidence that it can fulfil a cold outdoor outerwear role;
* actual thermal assessment still applies;
* the role does not create a fixed temperature guarantee.

---

## 5. Meaning of `weather_protection`

Keep the existing vocabulary: `rain`, `wind`. Do not add `cold` or `snow`. Cold is thermal
adequacy. Snow's relevant requirements are represented by thermal adequacy plus wet/wind protection
and exposure context. Do not add rain-protection levels in this slice.

**Binary semantics.** A populated value means: *this garment has meaningful, reliable protective
capability against this hazard.* It does NOT mean: *this is the only garment the user could
tolerate during five minutes of drizzle.* The distinction between required protection and
acceptable incidental exposure belongs to context/exposure policy, not a larger garment taxonomy.

---

## 6. Exposure policy

Do not implement `precipitation = rain → rain-protective coat required`. That is too strong.
Weather requirements depend on expected exposure. Use already-resolved structured context wherever
it supplies evidence about indoor vs outdoor destination, transit, activity, walking/outdoor
activity, and occasion/context.

```text
museum + rainy arrival/departure   → rain capability useful, brief exposure may allow ordinary outerwear
outdoor city walk + rain           → meaningful rain protection becomes important
hike + rain                        → meaningful wet-weather protection is strongly required
restaurant + car-to-door drizzle   → do not reject an otherwise sensible outfit solely for a non-rain coat
```

Do not add a mandatory user field for rainfall intensity or exposure duration in this slice. If
existing context cannot establish exposure strongly enough, return/retain uncertainty rather than
manufacturing a precise exposure fact.

---

## 7. Cold-weather behaviour

### Remove the semantic shortcut

Both of the following are invalid as sufficient evidence:

```text
Boolean(layer) === adequate cold-weather layer
sleeve-bearing outerwear === adequate cold-weather transit layer
```

Sleeve-bearing/removable construction is necessary for some transit contexts, but is not by itself
sufficient evidence of weather adequacy.

### Desired evaluation

For cold outdoor exposure or cold transit, shared outfit validation should consider:

```text
required removable coverage
+ outerwear functional role
+ thermal contribution of outerwear
+ thermal contribution of supporting layers
+ resolved cold severity/context
```

An `indoor_layer` may contribute warmth without independently satisfying the outdoor-outerwear
requirement. A `protective_shell` may satisfy barrier requirements while thermal adequacy comes
from pieces beneath it. A `transition_layer` may be sufficient in moderate cold if the existing
thermal model supports that conclusion. A `cold_weather_outerwear` piece provides strong functional
evidence but still participates in the same thermal evaluation.

**Do not build hard role-to-temperature boundaries.**

### **[A3]** Cold severity ruling — binding

Preserve the ratified distinction between `isCold` and `isColdSevere`
([cold-severity-spec.md](cold-severity-spec.md)). `isCold` remains the existing **minimum-warmth
floor**. This slice must not reinterpret every mildly cool/chilly context as requiring true
cold-weather outerwear.

**`isCold && !isColdSevere`**

* preserve the existing minimum-warmth requirement;
* use `outerwear_role` as capability evidence and ranking/model guidance;
* an `indoor_layer` is **not** automatically invalid merely because it is the only outer layer;
* do not introduce a new hard "must have outdoor outerwear" invariant;
* existing thermal and coverage rules continue to determine minimum adequacy.

This preserves the pinned contexts `cool coastal summer` and `chilly work dinner tonight`.

**`isColdSevere`**

The completed outfit must provide a credible outdoor-capable cold-exposure system when
outdoor/transit exposure exists. An `indoor_layer` alone cannot certify that requirement.

However, do NOT translate this into `outerwear_role must equal cold_weather_outerwear`. The system
may be adequate through combinations such as `protective_shell + substantial insulating layers
underneath`, or, where thermal evidence supports it, `transition_layer + sufficient supporting
insulation`. `cold_weather_outerwear` is strong positive evidence, not the only route to passing.

The hard verdict is therefore outfit-level — *does this completed outfit provide sufficient thermal
coverage plus an outdoor-capable outer layer for the resolved severe-cold exposure?* — and belongs
to `evaluateWearableOutfit()`. The existing `Boolean(layer)` shortcut in
`validateSlotOutfitConstraints()` must be **migrated to the shared verdict**, not replaced with a
role-enum check.

### **[R1]** Prerequisite — `isColdSevere` does not currently reach the validator

Verified 2026-08-31. `isColdSevere` is produced by `weatherProfileFromContext`
(`styling-engine/rules.js:156`) and today has exactly one engine consumer, the heavy-fabric
relevance bonus at `rules.js:3377`, plus a label at `tools.js:3168`.

The plan/capsule path **rebuilds the slot weather profile field by field and drops it**:

```js
// indoor slot — outfitSetPlanner.js:1012
isHot: t.isHot, isCold: false, isExtremeHeat: t.isExtremeHeat,
transitIsHot: t.isHot, transitIsCold: t.isCold, transitHighF: t.highF, transitLowF: t.lowF,
// outdoor slot — outfitSetPlanner.js:1024
isHot: t.isHot, isCold: t.isCold, isExtremeHeat: t.isExtremeHeat, highF: t.highF, lowF: t.lowF,
```

Neither carries `isColdSevere`, and there is no `transitIsColdSevere` at all. That profile is
exactly what reaches `validateSlotOutfitConstraints` (`outfitSetPlanner.js:4119`).

**Therefore:** propagating `isColdSevere`, and introducing `transitIsColdSevere` derived from the
same source facts (severe cold words, or an actual temperature ≤45°F, per
[cold-severity-spec.md](cold-severity-spec.md)), through slot-profile construction is a **required
step inside Slice D**, not an incidental edit. Without it a coder writes
`weatherProfile.isColdSevere` in the validator, reads `undefined`, and ships a branch that silently
never fires — with passing tests, because fixtures build the profile by hand.

Slice D acceptance must include a test asserting the flag survives real slot-profile construction,
not only a hand-built profile.

### **[R2]** Both cold branches, named explicitly

`validateSlotOutfitConstraints` contains two cold branches with **different meanings**, and both
migrate. They must not be merged:

| Branch | Line | Question it asks |
|---|---|---|
| `weatherProfile.isCold` | `outfitSetPlanner.js:3947` | Is the *system* warm enough? Accepts a heavy top/dress in place of a layer. |
| `weatherProfile.transitIsCold` | `outfitSetPlanner.js:3956` | Is there *removable outdoor-capable coverage* for arrival/departure? Only an actual layer counts. |

The transit branch is where `indoor_layer` vs `transition_layer` bites hardest, since `isCold` is
deliberately zeroed for indoor slots (`outfitSetPlanner.js:1012`, `:1380`, `:1676`).

`validateSlotOutfitConstraints` is census-classified `specialization` (slot weather / activity /
register / season and plan requirements). It **keeps that role**. It loses only these two
cold-layer branches to the canonical outfit validator; everything else in it stays.

---

## 8. Rain/wind behaviour

A weather hazard may produce either a **hard environmental inadequacy** or a **weather
preference/concern**. The shared verdict states the underlying fact. Flow policy decides whether to
exclude during automatic selection, down-rank, annotate, ask for revision, or disclose a wardrobe
gap. Do not let individual flows redefine what `weather_protection: rain` means.

**Existing footwear behaviour is preserved.** The structured wet-footwear gate, wet-sensitive
material handling and cold open-toe/sandal logic are not redesigned here. Do not add mesh to
wet-sensitive materials without a separate evidence/ruling.

---

## 9. Missing wardrobe supply

Do not silently certify an inadequate garment because nothing better exists. But also do not
hard-fail merely because the taxonomy lacks the perfect role value. The shared system must
distinguish `known inadequate` / `unknown` / `adequate` and allow existing supply-aware flow
disposition to act on the result.

**Clearly inadequate.** 35°F sustained outdoor exposure, only available layer = light indoor
cardigan → do not call the cardigan adequate cold-weather outerwear; return/disclose the shortfall.

**Plausibly adequate without a perfect role label.** 50°F, substantial lined jacket, strong
thermal/construction evidence, role missing or uncertain → do not reject solely because
`outerwear_role` is absent. Structured garment evidence and existing thermal logic remain
authoritative. This preserves the consolidation rule that unknown metadata is not automatically the
same thing as hard invalidity, and the predecessor spec's ruling that unknown/unset is a no-op.

### **[A4]** Known-inadequacy and no-valid-supply ruling — binding

A known hard environmental inadequacy MUST NOT be relabelled as an accepted outfit merely because
the wardrobe has no better piece. **Shared validation returns the same hard finding regardless of
wardrobe supply.** Existing flow disposition then applies:

* attempt valid recovery/substitution where that flow supports recovery;
* retry where that flow owns retry;
* reject the proposal where proposal disposition is strict;
* retain a paid invalid attempt as `Needs review` **only** where that existing product policy
  already preserves paid invalid attempts;
* disclose an explicit wardrobe/weather shortfall when no valid outfit can be produced;
* plan/capsule may surface the slot/set shortfall through their existing validation/disposition
  behaviour.

The system must distinguish:

```text
valid outfit  ≠  visible invalid attempt  ≠  wardrobe shortfall
```

No flow may silently present a known environmentally inadequate outfit as valid simply because
supply is exhausted. **No new cross-flow disposition rule is introduced**: the capability shortfall
travels as an ordinary hard finding on the existing `hardFindings` channel, which every named
consumer already handles.

### **[R3]** Prerequisite — unsatisfiable findings need a named legal move

Because §A4 makes the finding supply-independent, a wardrobe with (for example) zero
`cold_weather_outerwear` and a severe-cold outdoor slot creates an **unsatisfiable** hard finding.
`submit_plan_outfits` already hit exactly this failure shape once, for register floors, and needed
an explicit escape hatch:

> *"a floor rejection had no legal move inside `submit_plan_outfits` — resubmitting different
> pieces cannot raise a slot's floor, only a fresh `plan_outfit_set` call with a lower register
> can. Always name that escape hatch"* — `outfitSetPlanner.js:4118`

**Therefore:** when a severe-cold or hazard finding is unsatisfiable from the available roster, the
finding message must name the legal move (re-plan at a different context, or accept the disclosed
shortfall), following the register-floor precedent. The same guard applies to whole-wardrobe's
local candidate backfill and to every recovery path in §14: they must not loop attempting to repair
an unrepairable shortfall.

---

## 10. Model-facing garment truth

`outerwear_role` and `weather_protection` are garment facts. Expose them through the existing
canonical garment-truth projection path wherever the stylist is expected to reason about the piece
— executing the deferral recorded in §1 **[A5]**. Audit at minimum:

* wardrobe manifest;
* `search_wardrobe` result/truth rows;
* `view_pieces`;
* plan workbench projections;
* composer garment lines;
* capsule model-facing roster/workbench projections where applicable.

Do not write independent natural-language interpretations of the fields in each projection.
Projection code transmits canonical facts; it does not own their meaning. Prefer a shared
serializer/helper if equivalent formatting currently appears in multiple projections. Do not add
the fields blindly to image-only or unrelated contexts that cannot use them.

---

## 11. Existing special cases to audit

Identify all places that reconstruct outerwear capability from proxies such as
`category === outerwear`, `garmentKind === cardigan`, "medium/heavy cardigan", "has sleeves",
coat/puffer name checks. Classify each occurrence as: `canonical construction fact` /
`legitimate flow strategy` / `duplicate capability interpretation` / `legacy workaround`.

The winter capsule rule requiring a medium/heavy cardigan for a sleeveless indoor base
(`outfitSetPlanner.js:4111`, prose at `:3659`) is a required audit case. Do NOT mechanically
replace it. Determine whether the rule contains two meanings: (a) the layer must remain wearable
indoors; (b) the layer must provide sufficient warmth. If so, migrate (a) to shared `outerwear_role`
evidence while retaining (b) through the shared thermal owner.

### **[A6]** Migration direction — binding

The capsule cardigan rule is **not** the loose rule; it is stricter than the generic branch and is
evidence of the semantics the generic system should now understand.

> Tighten the generic `Boolean(layer)` cold-layer semantics through the shared capability/outfit
> verdict **first**. Do not weaken the capsule rule to match the generic rule. The
> capsule-specific cardigan rule may be removed only when the shared contract demonstrably subsumes
> both meanings it currently enforces: (a) an indoor-wearable layer must remain available, and
> (b) that layer must provide sufficient thermal contribution.

This protects against a "consolidation" that accidentally deletes useful behaviour.

---

## 12. Existing weather-context propagation

PR #284's structured weather resolution
([future-trip-weather-estimate-spec.md](future-trip-weather-estimate-spec.md)) is **not in scope for
redesign**. The current resolver supports field-by-field carry-forward (turn 1: temperature +
destination + date; turn 2: precipitation only → merged structured weather context), and subsequent
tool calls consume established resolved weather. Do not add a second weather-state mechanism. Do not
alter this behaviour unless an acceptance test demonstrates a concrete propagation defect; if QA
fails, report it separately before widening this slice.

---

## 13. Consumer migration

Trace active consumers from production entry points, not grep alone. At minimum verify the shared
verdict reaches the applicable semantics in:

1. selected-piece generation;
2. whole-wardrobe Visual Composer;
3. saved-outfit Similar/Creative through delegated whole-wardrobe flow;
4. `/ask` `search_wardrobe`;
5. `/ask` `propose_outfit`;
6. bounded `generate_outfits`;
7. `plan_outfit_set` / `submit_plan_outfits`;
8. seasonal capsule;
9. capsule expansion;
10. capsule repair/recovery;
11. local fallbacks/recovery paths capable of inserting outerwear.

Some flows inherit behaviour by delegation. Record that as delegation, not another implementation.
Search remains retrieval-oriented and may rank/broaden differently from a finite composer; that is
legitimate strategy. All consumers must share the underlying capability meaning.

---

## 14. Recovery invariant

No fallback, completion or repair path may reintroduce a garment that the authoritative
weather/capability verdict has established as hard-invalid for the exact context. Use the existing
validated-recovery architecture (`styling-engine/eligibility.js:67`; census "may reuse pieces
omitted only for presentation/capacity, but cannot reintroduce a weather… gate"). Do not write
weather-specific bypass logic in recovery.

---

## 15. Implementation sequence

### Slice A — read-only responsibility census

Before runtime changes: record current main SHA; inventory field definition/population, normalized
readers, current thermal/weather verdict owners, cold/wet outerwear decision surfaces, model-facing
projections, capsule/cardigan special cases, fallback/recovery paths; classify each surface as
`canonical` / `specialization` / `adapter` / `projection` / `duplicate` / `legacy` / `unresolved`;
identify all active consumers through actual call chains; list any remaining owner ruling genuinely
required.

Stop if an unresolved semantic contract is discovered that materially changes the rulings above. Do
not refactor during this slice.

### **[A1]** Slice A.1 — real-wardrobe capability audit — mandatory precondition

Before any runtime consumer is added, measure the actual state of `outerwear_role` and
`weather_protection` in the real wardrobe. Use the repository's database-safety procedure and a
read-only / isolated database workflow ([database-safety.md](database-safety.md)).

Record at minimum:

* total active outerwear pieces;
* count and percentage with populated `outerwear_role`;
* count by each role;
* count and percentage with non-empty `weather_protection`;
* count by `rain`, `wind`, and both;
* count of null/unset role;
* representative examples for every populated role/protection value.

Then manually review a representative sample against the garment images and existing structured
garment facts.

The purpose is **not** to achieve 100% tagging coverage. The purpose is to establish that
**populated capability facts are reliable enough to consume**.

**Stop condition.** Do not wire `outerwear_role` or `weather_protection` into runtime decisions if
the audit shows systematic misclassification or materially unreliable populated values. Fix
tagging/data quality first.

Missing values remain `unknown`/no-op and MUST NOT become exclusions merely because coverage is
incomplete.

This fulfils the previously ratified sequencing in
[outerwear-weather-capability-spec.md](outerwear-weather-capability-spec.md) §8/§10: ship → tag real
wardrobe → manually QA → add consumer.

### Slice B — canonical capability verdict

Implement the smallest shared primitive(s) required for Contract B: pure/deterministic; structured
result; consumes existing attribute readers; delegates thermal interpretation to the existing
thermal owner; explicit missing-data semantics; no flow labels or UI prose; direct unit tests. Do
not create a second full eligibility pipeline.

### **[A2]** Slice C — integrate capability evidence through the canonical eligibility owner

The ownership path is exact:

```text
pieceOuterwearRole() / pieceWeatherProtection()
        ↓
shared narrow capability verdict primitive
        ↓
wholeWardrobePieceTrustDecision()
        ↓
evaluateAutomaticUsePiecePool()
        ↓
evaluateAutomaticUsePiecePoolCore() / existing delegated consumers
```

`wholeWardrobePieceTrustDecision()` remains the canonical per-piece automatic-use aggregate. Do not
attach this behaviour independently at the pool wrapper, `search_wardrobe`, composer roster, plan
workbench, capsule roster, or another consumer.

**Critical eligibility boundary.** Contract B — outerwear functional capability — supplies
**evidence, not outfit-level adequacy**. A piece MUST NOT be hard-excluded from the candidate pool
merely because it cannot, by itself, satisfy the complete weather needs of an outfit:

* a thermally light `protective_shell` remains eligible in cold rain because insulation may be
  supplied underneath;
* an `indoor_layer` remains eligible in cold weather because it may be useful beneath actual
  outerwear;
* a `transition_layer` remains eligible in severe cold because it may participate in a thermally
  adequate layered system;
* missing `outerwear_role` remains `unknown` rather than prohibited.

Only existing genuinely per-piece weather invalidities remain hard eligibility gates, including the
currently ratified hot-weather insulation and footwear rules.

Contract C / `evaluateWearableOutfit()` owns the hard question: whether the completed outfit is
environmentally adequate.

Verify that search, selected generation, whole-wardrobe generation, and plan/capsule candidate pools
receive the same underlying findings wherever they use shared automatic eligibility. Flow-specific
ranking and supply-aware disposition remain unchanged unless explicitly required.

### Slice D — shared outfit validation integration

Extend the existing wearable-outfit validation ownership so outfit-level environmental adequacy can
compose thermal adequacy, required outerwear construction, outerwear capability, and environmental
protection.

Includes, as required steps: the `isColdSevere` / `transitIsColdSevere` propagation of **[R1]**;
the migration of **both** cold branches per **[R2]**; and the unsatisfiable-finding escape hatch of
**[R3]**.

Remove/retire duplicate "any outerwear counts" semantics after tests demonstrate replacement
behaviour. Flow disposition remains local.

### Slice E — fact projection

Expose canonical outerwear capability facts to model-facing consumers through shared projection
helpers (§10). Do not put semantic rules into tool descriptions or prompts that code does not own.
Where a model prompt needs explanatory guidance, project wording from the canonical owner or a
shared serializer rather than copying independent definitions.

### Slice F — legacy/special-case cleanup

Only after all named consumers use the shared contracts: remove duplicated cold-layer heuristics
whose semantic responsibility is now canonical (respecting **[A6]**'s direction); simplify capsule
cardigan logic where appropriate; remove dead private helpers; update imports and tests. Do not
remove legitimate flow strategy.

---

## 16. Tests

All structural acceptance must be offline/deterministic.

**Fact-reader fixtures.** `indoor_layer`, `transition_layer`, `protective_shell`,
`cold_weather_outerwear`; `rain`, `wind`, `rain + wind`, empty, invalid/missing, non-outerwear stray
values. (Largely already pinned in `test/outerwearRole.test.js`.)

**Thermal/capability orthogonality.**

```text
heavy cashmere cardigan → thermally warm, indoor_layer, not automatically cold-weather outerwear
light rain shell        → thermally light, protective_shell, rain protection
heavy wool coat         → thermally strong, cold_weather_outerwear, no automatic rain protection
windbreaker             → protective_shell, wind, no automatic rain protection
```

**Cold transit.**

```text
cold indoor museum + sleeveless outfit + no outerwear      → rejected/shortfall
cold indoor museum + sleeve-bearing light indoor cardigan   → contributes warmth; must not
                                                              automatically pass as adequate transit outerwear
cold indoor museum + suitable transition/cold outer layer   → passes when thermal evidence supports it
cold indoor museum + protective shell + adequate insulation → can pass as a system
```

**Cold severity **[A3]**.** Explicitly assert both tiers: `isCold && !isColdSevere` with an
`indoor_layer`-only outfit does **not** hard-fail; the same outfit under `isColdSevere` with
outdoor/transit exposure does. Re-assert the pinned `cool coastal summer` and `chilly work dinner
tonight` fixtures unchanged.

**Severity propagation **[R1]**.** Assert `isColdSevere` / `transitIsColdSevere` survive real slot
weather-profile construction and reach `validateSlotOutfitConstraints` — not only a hand-built
profile.

**Outdoor cold.** Verify that existence of arbitrary outerwear no longer satisfies the cold
requirement.

**Rain.**

```text
brief indoor-destination transit + rain              → ordinary outerwear not universally hard-rejected
meaningful outdoor rain exposure + rain-protective   → positive capability evidence
meaningful outdoor rain exposure + clearly unsuitable→ finding/shortfall per shared policy
```

Do not introduce a generic `rain => raincoat` fixture.

**Missing metadata.** Missing `outerwear_role` is `unknown`, not automatic exclusion, when concrete
garment facts can still support evaluation.

**Eligibility boundary **[A2]**.** Assert that each of the four example pieces above remains in the
candidate pool under the stated weather — a capability shortfall must never appear as a pool
exclusion.

**Recovery.** For every recovery path capable of adding/replacing outerwear: a hard-invalid
candidate cannot return as accepted recovery.

**Unsatisfiable supply **[R3]**.** With a roster containing no adequate cold outerwear, assert the
hard finding still fires, that the message names a legal move, and that plan submission /
whole-wardrobe backfill terminate rather than loop.

### **[A7]** Cross-flow parity — scoped to real ownership boundaries

Testing all eleven pipelines independently would prove delegation repeatedly. Run full behavioural
parity fixtures against **representative direct consumers only**:

1. shared automatic-use eligibility / whole-wardrobe path;
2. `/ask` search/proposal;
3. plan validation;
4. capsule path;
5. one recovery/fallback path.

Delegated consumers (saved-outfit Similar/Creative, bounded `generate_outfits`) need **wiring /
inheritance assertions**, not duplicated behavioural suites — matching how the census already
records them as delegation.

---

## 17. Live QA

After deterministic tests pass, use a very small live QA set. The PR #284 fresh-thread weather
sequence remains useful: establish 50°F / 40°F + destination/date; add rain on a later search
without repeating temperature/location/date; propose an indoor museum outfit without repeating
weather; inspect cold-transit outerwear and footwear behaviour.

Add targeted outerwear cases using known wardrobe pieces: indoor-layer cardigan, real transition
jacket, cold-weather coat if available, rain/wind shell if available.

The purpose of live QA is model/tool integration, not proving deterministic semantics already
covered offline. Do not spend calls benchmarking every flow where delegated/shared offline tests
prove the same code path.

---

## 18. Observability

Where existing eligibility/validation diagnostics expose findings, preserve outerwear capability
findings there. Use stable finding codes rather than prose-only logging. Illustrative:

```text
outerwear_indoor_role_insufficient_for_cold_exposure
outerwear_thermal_capacity_insufficient
outerwear_rain_protection_missing
outerwear_capability_unknown
```

Do not add a separate telemetry subsystem.

---

## 19. Documentation

Update existing authorities in the implementation PR rather than creating another behavioural map.

* **[garment-field-reference.md](garment-field-reference.md)** — `outerwear_role`,
  `weather_protection`, their separation from thermal warmth, missing-data meaning.
* **[engine-behaviour-map.md](engine-behaviour-map.md)** — shared outerwear capability verdict,
  integration into eligibility/validation, flow disposition boundaries, retired duplicate
  heuristics.
* **[architecture-responsibility-census.md](architecture-responsibility-census.md)** — amend the
  ownership index: `outerwear weather capability → canonical fact readers → canonical verdict
  primitive → shared eligibility / wearable-validation consumers`.
* **Flow docs** — only those whose actual sequence changed.
* **[message-lifecycle.md](message-lifecycle.md)** — only if `/ask` state/tool handoff actually
  changes. Exposing additional garment facts does not justify rewriting it.

---

## 20. Explicit non-goals

This work does NOT: redesign the general weather resolver; change PR #284 carry-forward semantics;
create a meteorological taxonomy; add `cold` or `snow` to `weather_protection`; add waterproofness
grades; ask the user to classify technical fabric performance; add temperature ranges to outerwear
roles; replace existing warmth logic; redesign shoe wet-weather behaviour; classify mesh as
wet-sensitive; unify all flow ranking; merge all stylist prompts; create a universal outfit
pipeline; or make the model the authority on deterministic garment facts.

---

## 21. Acceptance criteria

1. `outerwear_role` and `weather_protection` are no longer inert stored facts.
2. They have one canonical interpreted meaning.
3. Thermal warmth and outerwear function remain independent axes.
4. Arbitrary outerwear presence can no longer mechanically certify cold-weather adequacy.
5. `indoor_layer` can contribute warmth without masquerading as genuine cold outerwear.
6. A protective shell can provide rain/wind capability without being treated as insulated.
7. Rain does not mechanically require rain-protective outerwear in every context.
8. Missing role metadata is not silently converted into hard invalidity.
9. Model-facing styling paths receive the canonical capability facts where relevant.
10. Search, proposal, generation, plan and capsule paths do not maintain independent definitions of
    outerwear weather suitability.
11. Recovery cannot bypass a hard weather/capability finding.
12. Existing PR #284 structured weather carry-forward behaviour remains intact.
13. No new user-entered garment-physics fields are introduced.
14. No new parallel eligibility/weather architecture is introduced.
15. The architecture responsibility census and behaviour map identify the final owner and active
    consumers.
16. Deterministic cross-flow fixtures prove the same semantic finding reaches every applicable
    consumer, scoped per **[A7]**.
17. **[A1]** The Slice A.1 real-wardrobe audit ran and its stop condition was not triggered.
18. **[A2]** No capability shortfall appears as a candidate-pool exclusion.
19. **[A3]/[R1]** `isCold` retains its floor semantics; `isColdSevere` reaches the validator through
    real slot-profile construction.
20. **[A4]/[R3]** No flow presents a known-inadequate outfit as valid on supply exhaustion, and no
    unsatisfiable finding leaves a flow without a named legal move.

---

## Appendix A — Slice A / A.1 results (run 2026-08-31)

**Branch:** `spec/outerwear-weather-consolidation`, based on `b6eeb86` (`fix/structured-weather-context`).
**Audit tool:** `scratch/audit_outerwear_capability_coverage.js` — opens the database read-only,
imports no application code, re-runnable.

### A.1 — real-wardrobe capability audit: **STOP CONDITION TRIGGERED**

```text
active pieces (all categories)      261
active outerwear pieces              31

outerwear_role populated              8 / 31   (25.8%)
  indoor_layer                        4
  transition_layer                    3
  protective_shell                    1
  cold_weather_outerwear              0
  null / unset                       23 / 31   (74.2%)
  stored-but-unrecognized             0

weather_protection non-empty          1 / 31   (3.2%)
  rain                                0
  wind                                1
  malformed / stray members           0
```

**The populated values are trustworthy.** All eight read correctly against their garment names and
fabric weights — `striped knit cardigan` / `sheer black shrug` → `indoor_layer`; `gray jacket`,
`red tweed cropped jacket` → `transition_layer`; `olive green lightweight jacket` →
`protective_shell` + `["wind"]`. No integrity problems. The tagger, added 2026-08-21, is producing
correct values when it runs.

**The coverage is not.** Every piece that would actually exercise the rulings in this spec is
untagged:

```text
996775  Black puffer coat                  heavy    → would be cold_weather_outerwear
996765  brown long leather coat            heavy    → would be cold_weather_outerwear
996760  cream and taupe plaid fleece coat  heavy    → would be cold_weather_outerwear
996759  cream trench coat with belt        medium   → transition_layer / possible rain
996763  pink raincoat                      medium   → would be protective_shell + ["rain"]
+ 18 more, incl. 7 cashmere/wool cardigans and vests that would be indoor_layer
```

The wardrobe contains **zero** tagged `cold_weather_outerwear` and **zero** tagged `rain`
protection. Since §9 and §15/A.1 both require unset values to remain `unknown`/no-op, wiring the
consumer against this data produces a system that is **inert in exactly the cases it exists to
decide** — the severe-cold branch of **[A3]** and the whole of §8 would never fire in production,
while passing every offline fixture, because fixtures build pieces by hand.

This is the failure Slice A.1 was written to catch. Per its stop condition: **fix data quality
first.**

**Cause, and why this is not "retagging the wardrobe."** These 23 pieces were tagged before
`outerwear_role`/`weather_protection` existed. The fields were added to `tagPiecePromptTemplate`
(`styling-engine/prompts.js:986-987`) and `/extract-pieces` (`routes/ai.js:1542-1543`) on
2026-08-21; nothing re-ran the existing pieces through it. This is a **one-category, 23-piece
backfill of a field added after those rows were written** — the standard new-field backfill, not a
re-tag of the wardrobe. It is a paid model operation and therefore an owner decision, not one this
slice takes on its own.

**Owner ruling required (1 of 2).** Authorize a scoped backfill of `outerwear_role` /
`weather_protection` for the 23 untagged active outerwear pieces, then re-run the audit and
manually review the five decisive coats above against their photos. Slices B–F stay blocked until
that review passes.

### A — responsibility census: one unresolved contract found

Classifying the surfaces named in §15 Slice A:

| Surface | Location | Class | Note |
|---|---|---|---|
| `outerwear_role` / `weather_protection` columns | `db.js:416-424`, `:1128` | canonical | migration + `safeJsonParse` array parse |
| `pieceOuterwearRole` / `pieceWeatherProtection` | `attributes.js:182`, `:193` | canonical | category-gated, defensive; **zero engine consumers** |
| `normalizeOuterwearRole` / `normalizeWeatherProtection` | `taggerMerge.js:124`, `:332-333` | canonical | strict enum, silent null/drop |
| `pieceWeatherScores` / `weatherFitForPiece` / `pieceWeatherEvidence` | `rules.js:264`, `:287`, `:343` | canonical | Contract A owner; unchanged by this slice |
| `weatherProfileFromContext` (`isCold` / `isColdSevere`) | `rules.js:97`, `:156` | canonical | severity tier; see **[R1]** |
| `wholeWardrobePieceTrustDecision` | `rules.js:2693` | canonical | per-piece automatic-use aggregate; already takes `weatherProfile` |
| `evaluateAutomaticUsePiecePool` / `…Core` | `eligibility.js:31`, `automaticUsePool.js` | canonical | pool projection of the above; recovery invariant at `eligibility.js:67` |
| `evaluateWearableOutfit` | `outfitValidation.js:759` | canonical | **weather-blind — see below** |
| `locallyGateWholeWardrobeOutfits` | `rules.js:5318` | specialization | whole-wardrobe gate; has `weatherProfile` *and* calls `evaluateWearableOutfit` (`:5359`) |
| `validateSlotOutfitConstraints` | `outfitSetPlanner.js:3930` | specialization | plan slot; owns both cold branches (**[R2]**) |
| winter-capsule cardigan rule | `outfitSetPlanner.js:4111`, prose `:3659` | duplicate capability interpretation | migrate per **[A6]** only |
| `Boolean(layer)` cold shortcut | `outfitSetPlanner.js:3947` | duplicate | migrate |
| transit sleeve-bearing check | `outfitSetPlanner.js:3956` | duplicate (partial) | migrate; distinct meaning |
| `garmentKind`/name-based outerwear inference | `core.js:1547`, `attributes.js:767`, `:943` | legacy fallback | out of scope — category resolution, not capability |
| Truth-surface projections | manifest / `search_wardrobe` / `buildWardrobePieceTruthText` | projection | Slice E; deliberately deferred per **[A5]** |

**Unresolved contract — `evaluateWearableOutfit` has no weather input at all.** Verified: the file
contains **zero** occurrences of `weather`. Its signature is
`{ requireShoes, roleAware, includeRoles, includeLayerDirections, seenPieceIds }`, and all ten call
sites (`rules.js:4970`, `:5359`; `tools.js:1762`, `:2028`, `:2251`; `core.js:620`;
`outfitSetPlanner.js:4096`; `routes/ai.js:1162`, `:1381`, `:2602`) pass no context. It is
deliberately a *garment-system* validator — structure, required base layers, layer direction, layer
construction — asking "is this outfit physically wearable," not "is it wearable **here**."

§3's Contract C therefore cannot simply "belong to the existing wearable-outfit validation
architecture": that owner would have to change category to accept it. The only shared outfit-level
functions that already receive `weatherProfile` are the two `specialization` wrappers,
`locallyGateWholeWardrobeOutfits` and `validateSlotOutfitConstraints` — which is precisely why the
cold semantics ended up duplicated in them.

Per Slice A's own instruction ("stop if an unresolved semantic contract is discovered"), this stops
here rather than being decided in code.

**Owner ruling required (2 of 2).** Where does Contract C live?

* **Option 1 — optional weather stage inside `evaluateWearableOutfit` (recommended).** Add a
  `weatherContext` option and a `weather` stage that runs only when supplied; the two existing
  context-aware wrappers pass it, the other eight call sites are unchanged. Keeps one canonical
  outfit validator and one findings channel (§A4 depends on the `hardFindings` stream). Cost: the
  canonical validator stops being context-free, and the eight context-free callers silently get no
  weather verdict — acceptable only if each is confirmed to be a genuinely context-free use.
* **Option 2 — a sibling canonical `evaluateOutfitEnvironmentalAdequacy`,** composed by the same
  wrappers alongside `evaluateWearableOutfit`. Keeps the structural validator pure. Cost: two
  outfit-level owners, and §A4's single-channel disposition argument weakens.
* **Option 3 — leave Contract C in `validateSlotOutfitConstraints`.** Rejected: plan-only, and it
  would leave whole-wardrobe/`/ask`/capsule with no owner, re-creating the duplication in §2.

Recommendation: **Option 1**, with the eight context-free call sites audited and recorded in Slice
D rather than assumed.

### Status after Slice A / A.1

* Slice A — complete; one unresolved contract raised (above).
* Slice A.1 — complete; **stop condition triggered**, Slices B–F blocked.
* No runtime code changed on this branch. Spec, doc index, predecessor cross-reference, and the
  re-runnable audit script only.

---

## Appendix B — owner rulings and their execution (2026-08-31)

Both blocking rulings from Appendix A were given on 2026-08-31.

### [O1] Scoped 23-piece outerwear backfill — authorized and executed

> *"Use the normal current tagger and fill only the later-added `outerwear_role` /
> `weather_protection` fields; preserve manual values and do not opportunistically retag unrelated
> metadata. Rerun A.1 afterward and manually inspect the puffer, leather coat, fleece coat, trench,
> and raincoat. If those are materially correct and the distribution is sensible, the data-quality
> precondition passes."*

Executed with `scratch/backfill_outerwear_capability.js` — dry-run by default, `--tag` for model
calls, `--tag --apply` to write. Field isolation is structural: the tagger returns its full tag set
and the script reads exactly two keys from it, normalizes them through `normalizeOuterwearRole` /
`normalizeWeatherProtection`, and issues an `UPDATE` touching exactly those two columns. A field
listed in the piece's `manual_overrides` keeps its stored value. A `VACUUM INTO` snapshot is taken
before the first write.

**Routing: Gemini** (owner instruction, same day), via the sanctioned per-call `providerOverride`
argument on `tagPieceWithProvider` — the path the comparison-run scripts use.
`gemini-3.1-flash-lite` is `TAGGER_MODEL_OVERRIDE`'s own default and the tier
[tagger-cost-spec.md](tagger-cost-spec.md) §6d benchmarked strongest on cost and failure rate.
Routing verified after the fact against `ai_call_log`, not assumed: 28 calls, all
`gemini`/`gemini-3.1-flash-lite`, **$0.1372** measured.

**Result — coverage**

```text
                          before        after
outerwear_role populated   8 / 31       31 / 31   (25.8% → 100%)
  indoor_layer             4            19
  transition_layer         3             9   (incl. one owner-set, below)
  protective_shell         1             2
  cold_weather_outerwear   0             1
weather_protection         1 / 31        7 / 31
  rain                     0             1
  wind                     1             7
integrity problems         0             0
```

**Result — the five decisive coats, manually inspected against their photos**

| Piece | Verdict | Assessment |
|---|---|---|
| `996775` Black puffer coat | `cold_weather_outerwear` + `["wind"]` | **Correct.** Worn photo: long quilted down coat, fur-trimmed hood, worn in a winter city with hat and gloves. Unambiguous. |
| `996763` pink raincoat | `protective_shell` + `["rain","wind"]` | **Correct role.** Technical hooded anorak, storm flap over zip, drawstring waist. See watch item below on the hazard pair. |
| `996765` brown long leather coat | `transition_layer` + `["wind"]` | **Correct.** Knee-length nubuck leather parka with hood and drawstring — dense and wind-blocking, but no insulation. Not cold-weather outerwear. |
| `996759` cream trench coat | `transition_layer` + `["wind"]` | **Correct.** Classic unlined gabardine double-breasted trench. Conservatively no `rain`, consistent with the predecessor spec's "construction evidence, not garment archetype" discipline. |
| `996760` plaid fleece coat | `null` → owner-corrected to `transition_layer` | **A real tagger miss, not a correct refusal.** See the correction below. |

#### Correction — `996760`, and what it actually shows

This entry was first written up as the tagger correctly declining an outerwear-only field because
it read the garment as a top. **That was wrong, and the owner corrected it.** The piece is a thick
synthetic pile-fleece buffalo-plaid quarter-zip hoodie — a *pullover*, which is the likely reason Gemini
returned `category: "top"` at high confidence, but functionally an outer layer the owner wears in
the mid-50s°F.

Routing was checked before accepting the model's answer as the model's actual answer: `ai_call_log`
confirms all 28 calls, including that probe, ran on `gemini-3.1-flash-lite`. So this was Flash's
real answer, not a mis-routed call to another tier.

But "the tagger got it wrong" is the wrong lesson. **This garment's role is not derivable from its
photo.** Hanger-hung it presents a sweatshirt silhouette — ribbed hem and cuffs, kangaroo pocket,
quarter-zip, hood — and a careful human reading the same image lands on `top` too. What actually
settles it is how the owner wears it: as the outer layer, in the mid-50s. No photo carries that.

Resolution: `outerwear_role = 'transition_layer'` (owner's "good for mid 50s" is the definition of
that value), written directly and added to the piece's `manual_overrides` so no future tagging pass
can silently overwrite an owner ruling. The stored `category` was left alone per this ruling's
"do not opportunistically retag" clause. Coverage is now **31/31**.

**Third watch item: photo-ambiguous outer layers, and a pin/gate interaction.**

A class of garment — pullover fleeces, hoodies, anoraks, popovers, shackets — reads as a top from a
hanger photo and functions as outerwear in wear. For these, `outerwear_role` is a *wear-behaviour*
fact, not a construction fact, so no tagger tier can be relied on to get it right and re-running
tagging will not converge. `996760` is the live instance.

That exposes a mechanism worth stating precisely, because it is easy to state wrongly. **Manual
overrides do survive retagging — the pin is not broken.** Verified offline against
`applyTaggerResult`: with `outerwear_role` pinned, a retag returning `category: 'top'` and
`outerwear_role: null` leaves the stored role as `transition_layer`, exactly as designed.

What does not survive is the value's *readability*:

```text
retag returns category:'top', outerwear_role:null   (role pinned, category NOT pinned)
  → stored category      becomes 'top'        (unpinned, so it changes)
  → stored outerwear_role stays 'transition_layer'   ← pin held
  → pieceOuterwearRole() returns null               ← gated on category
```

The owner's value is intact in the database and no consumer can see it. This is not a violation of
the manual-override guarantee; it is an **interaction** between a per-field guarantee and a
category-gated reader: pinning field A does not protect A's readability when unpinned field B gates
it. Four readers in `attributes.js` have this shape today — `pieceOuterwearRole` and
`pieceWeatherProtection` (gated on `outerwear`), `pieceIsOpenToe` and `pieceHeelHeight` (gated on
`shoes`, `attributes.js:503`, `:512`). Measured 2026-08-31: 260 pieces carry at least one manual
override; only 8 pin `category`.

Consequences:

1. **Pin the gating category alongside the gated field** whenever an owner ruling sets a
   category-gated value on a garment whose category is itself contestable. Done for `996760`.
2. **Check this class before any wardrobe-wide retag** — the failure is silent disappearance, not a
   visible error.
3. A general fix (auto-pinning the gating category when a category-gated field is pinned) is a
   `taggerMerge`/`PieceForm` change, **out of scope for this spec** and recorded here only so the
   next person finds the analysis rather than redoing it.

This is also a point in favour of the architecture as specified: an unresolvable-from-photo garment
lands in `unknown`, which §9 and Contract B already treat as a no-op rather than an exclusion. The
failure mode is silent disappearance under retagging, not bad gating.

**Precondition verdict: PASS.** The distribution is sensible — 19 `indoor_layer` matches a wardrobe
whose outerwear is mostly cardigans and vests; the single `cold_weather_outerwear` matches a
wardrobe with exactly one real winter coat. One misclassification found and corrected, on a
construction (pullover outerwear) that is now a recorded watch item rather than a systematic
failure. Slices B–F are unblocked.

**Two watch items, recorded rather than acted on:**

1. `996763` returned `["rain","wind"]`, where the predecessor spec's pinned fixture #10 says a
   raincoat should be `["rain"]` and not default to both. For *this* garment (technical face fabric,
   storm flap, hooded anorak) both are defensible, so this is not a violation — but it is the exact
   shape fixture #10 guards against. Re-check it if `rain` coverage grows.
2. `wind` now appears on 7 pieces including two leather garments and a plaid jacket. Dense leather
   and gabardine genuinely block wind, so each is individually defensible, but fixture #13's
   discipline ("never inferred from fabric weight alone") makes `wind` the value most at risk of
   quiet inflation. Re-run the audit's §5 cross-field flags after any future tagging pass.

**One residual data question, not blocking:** `996760`'s stored category (`outerwear`, and correct
per the owner) and the tagger's reading (`top`) still disagree. That is a category-truth question,
out of scope for this spec and untouched by it beyond the role pin.

### [O2] Contract C placement — ruled

Recorded inline at §3 Contract C as **[O2]**. In summary: `evaluateWearableOutfit()` becomes the
canonical outfit-validity **aggregator** with optional resolved context; weather semantics live in a
narrow sibling primitive, conceptually `evaluateOutfitEnvironmentalAdequacy(pieces, resolvedContext)`,
whose findings the aggregator composes when authoritative context is supplied. `isColdSevere` lives
in that outfit-level verdict, never in the per-piece Contract B primitive. The verdict consumes the
canonical resolved `weatherProfile`/context only and never parses prose, location, or dates.

This resolves Appendix A's open question in favour of a variant of Option 2 nested inside Option 1's
single findings channel — which preserves **[A4]**'s single-`hardFindings` disposition argument while
keeping the structural validator free of weather semantics.

**Consequent Slice D obligations (amending §15 Slice D):**

* audit each existing `evaluateWearableOutfit()` call site: pass resolved context where the flow
  already owns it, leave deliberately context-free consumers context-free, and **record any
  lost-context path as a migration finding** rather than papering over it;
* never manufacture weather context locally to satisfy the new stage;
* migrate the duplicate cold semantics out of `locallyGateWholeWardrobeOutfits` and
  `validateSlotOutfitConstraints` **only once those wrappers consume the shared finding**. Their
  flow-specific disposition and slot logic stays local.

---

## Appendix C — Slice B and Slice C results (2026-08-31)

### Slice B — canonical capability verdict: complete

`styling-engine/outerwearCapability.js`, `test/outerwearCapability.test.js` (14 tests).

* `evaluateOuterwearCapability(piece, requirement)` — Contract B. Pure, deterministic, imports only
  the two attribute readers. The caller supplies the *requirement* (`requireOutdoorLayer`,
  `requiredHazards`) that Contract C derives from resolved context, so per **[O2]** `isColdSevere`
  never appears in this file: a piece cannot know how cold it is, only what job it is built for.
* `pieceOuterwearCapabilityFacts(piece)` — the same reading with no requirement and therefore no
  verdict, used by Slice C.
* Stable finding codes exported as `OUTERWEAR_CAPABILITY_CODES` (§18).

**One contract the live audit forced into the primitive.** `weather_protection` column-defaults to
`'[]'`, so an empty array cannot by itself distinguish "the tagger looked and found no protective
construction" (evidence of absence) from "nothing ever asked" (no evidence). A populated
`outerwear_role` is the proxy that separates them, exposed as `capabilityTagged`. Consequently a
missing hazard on an **untagged** piece returns `unknown`, while the same missing hazard on a
**tagged** piece returns `insufficient`. Appendix B's `996760` was a live instance of the first
state, so this distinction is load-bearing rather than theoretical.

The orthogonality tests assert against the real thermal owner rather than restating this module's
logic: `pieceWeatherScores` gives the heavy cashmere cardigan `cold: 14` and the light rain shell
`cold: -8`, while capability calls the first *insufficient* as an outdoor layer and the second a
*pass*. If Contract A and Contract B ever collapse into one another, that test fails.

### Slice C — shared eligibility integration: complete, and deliberately thin

`styling-engine/automaticUsePool.js` (one field), `test/outerwearCapabilityEligibility.test.js`
(6 tests).

Owner ruling **[O2]** moved the environmental verdict to outfit level, which **shrank this slice to
almost nothing — and that is the correct outcome, not an under-delivery.** Once Contract C owns the
judgment, a per-piece pool has nothing left to decide about outerwear capability. What remains is
making one reading of the two fields available to every consumer:

```js
// evaluateAutomaticUsePiecePoolCore, per decision
capability: pieceOuterwearCapabilityFacts(piece),
```

Every consumer of the canonical pool — search, selected generation, whole-wardrobe, plan workbench,
capsule roster, recovery — now reads the same interpretation through
`decisionsById.get(id).capability` instead of re-deriving the category guard.

**The [A2] boundary is structural, not merely intended.** The facts are attached as a *field*, not
as a finding. `allowed` is computed from the trust verdict alone, and nothing in this path can
append to `findings` or flip `allowed`. There is no code route by which a capability shortfall could
become a pool exclusion — which is what the boundary requires, since a shell that under-insulates
alone is still a legitimate candidate underneath a sweater.

Pinned by test: all four outerwear fixtures stay eligible under `{}`, `{isCold}` and
`{isCold, isColdSevere}`; the findings stream gains nothing; no excluded projection ever cites a
capability reason.

### Status

* Slices A, A.1, B, C — complete.
* Slice D (Contract C, the `isColdSevere`/`transitIsColdSevere` propagation of **[R1]**, both cold
  branches per **[R2]**, the escape hatch of **[R3]**) — next.
* Slices E, F — after D.
* Test suite: 1639/1640. The one failure (`accountSettingsLayout.test.js`, sample-data disclosure)
  fails identically on a stashed tree and is unrelated to this work.

---

## Appendix D — Slice D results (2026-08-31)

Contract C, its composition into the aggregator, the `[R1]` propagation, the `[R2]` migration and
the `[R3]` escape hatch. **1660/1661 tests pass** (the one failure, `accountSettingsLayout.test.js`,
fails identically on a stashed tree).

### D.0 — a prerequisite the census did not catch: the thermal owner was unreachable

`rules.js` imports `evaluateWearableOutfit` (`rules.js:18`), so `outfitValidation.js` cannot import
`rules.js` back — and Contract A (`pieceWeatherScores`) lived in `rules.js`. Contract C therefore
could not compose real thermal evidence without either an import cycle or a second interpretation
of warmth, and a second interpretation is precisely what §3 forbids.

Resolved by relocating the graded thermal model **verbatim** to `styling-engine/thermal.js`
(`fabricMassIndex`, `heatCoverageScale`, `WEATHER_EVIDENCE_WEIGHTS`, `pieceWeatherEvidence`,
`pieceWeatherScores`). `rules.js` re-exports both public functions, so **no call site changed** and
the full suite confirmed behavioural neutrality before any Contract C code was written. The block
depended only on `attributes.js` readers, which is what made the move safe.

### D.1 — Contract C

`styling-engine/outfitEnvironmentalAdequacy.js`, `test/outfitEnvironmentalAdequacy.test.js`
(21 tests). `evaluateOutfitEnvironmentalAdequacy(pieces, resolvedContext)` composes Contract A
(thermal) and Contract B (function), owns `isColdSevere`, and consumes the canonical resolved
profile only. With no `weatherProfile` it returns `applicable: false` and no findings.

Composed into `evaluateWearableOutfit` as an opt-in `environment` stage behind a new
`weatherContext` option (`[O2]`): supply context and the stage runs; supply nothing and the function
is byte-for-byte the validator it was.

**The severity ladder, and why it is asymmetric.** A first implementation hard-failed
"outdoor-capable layer but thin insulation" and "unknown capability plus thin insulation". Three
plan fixtures caught it — untagged, `fabric_weight: light` coats at a 45°F low — and they were
right: that rule converts *missing metadata* into hard invalidity, which acceptance criterion 8
forbids. Corrected to:

```text
HARD      no outer layer at all in severe cold
HARD      every layer present is tagged indoor_layer          ← positive evidence of inadequacy
advisory  capability unknown and little thermal evidence      ← absence of evidence, not evidence
advisory  outdoor-capable layer, little insulation recorded
```

Criterion 4 still holds: arbitrary outerwear no longer certifies cold adequacy, because a tagged
`indoor_layer` now fails outright — the case the spec was written for.

### D.2 — `[R1]` severity propagation

`isColdSevere` was resolved but never reached a consumer. Fixed at the canonical resolution point
rather than at the call site: `resolveTemperatureField` (`weather.js`) now emits it on all four
branches, and `BAND_FLAGS` carries it per band. This is a **derivation, not a new threshold** —
`COLD_F` is 45 and [cold-severity-spec.md](cold-severity-spec.md)'s severe rule is "≤45°F or a
severe cold word". The mild-cool vocabulary that produces non-severe cold ("chilly", "cool",
"foggy") only ever reaches `weatherProfileFromContext`'s prose path, never this structured one.

`outfitSetPlanner` now carries `isColdSevere` on the outdoor slot profile and introduces
`transitIsColdSevere` on the indoor one.

**A second silent-loss path, found by the suite.** The first propagation pass made
`resolveWeatherContext` round-tripping fail: severity resolved but was dropped by
`serializeResolvedWeatherContext`/`restoreResolvedWeatherContext`. That is `[R1]`'s failure mode one
layer up — a field that survives resolution but not persistence vanishes on the next turn's
carry-forward, which §12 requires to stay intact. Fixed by adding `is_cold_severe` to the persisted
shape. Pinned by a test that exercises the real resolver and the real serializer, not a literal.

### D.3 — `[R2]` both cold branches migrated

Both branches left `validateSlotOutfitConstraints` **only after** its caller began consuming the
shared finding, per `[O2]`.

An important correction to the spec's own framing: Contract C fires only on **severe** cold, so
deleting the old branches outright would have dropped the mild-cold minimum-warmth floor — a
regression `[A3]` explicitly forbids. Both meanings were therefore migrated intact into Contract C:

| Migrated | Fires on | Message |
|---|---|---|
| minimum-warmth floor, heavy-main allowance included | any `isCold` | `no warm layer for cold weather` — verbatim |
| removable sleeve-bearing transit coverage | any `transitIsCold` | verbatim |

Messages are preserved exactly, and the escape hatch is deliberately **not** appended to them:
both are always satisfiable, so supply advice there would be noise and would change strings
consumers already depend on. `validateSlotOutfitConstraints` keeps its `specialization` role for
slot register, activity, season and plan requirements.

### D.4 — call-site audit (`[O2]` obligation)

| Call site | Owns resolved context? | Action |
|---|---|---|
| `outfitSetPlanner.js:4096` submitted-plan validation | yes — `slot.weatherProfile`, `slot.environment` | **passes context** |
| `rules.js` `locallyGateWholeWardrobeOutfits` | yes — supplied `weatherProfile` | **passes context**, deliberately the *supplied* profile and never `resolvedWeatherProfile`, whose `weatherProfileFromContext({mood, season})` fallback is a local prose derivation. `[O2]` forbids manufacturing context; that fallback remains fine for this wrapper's own ranking and repair. |
| `rules.js` whole-wardrobe repair `validate` | no | context-free, unchanged |
| `tools.js` ×3 (`propose_outfit`, correction, swap) | no weather in scope at the call | **lost-context migration finding** — the freeform tool context resolves weather elsewhere in the turn; threading it here is Slice E/F work, not a silent omission |
| `core.js:620` | no | context-free, unchanged |
| `routes/ai.js` ×3 | no | context-free, unchanged |

Two of ten sites pass context today. The three `tools.js` sites are recorded as the open migration
finding `[O2]` asked for, rather than being papered over by inventing a profile locally.

### D.5 — one test updated deliberately

`styling_context_consumers.test.js`'s whole-wardrobe assertion pinned the literal call shape
`evaluateWearableOutfit(pieces, { requireShoes })`. The pinned *contract* — this gate consumes the
composed wearable verdict rather than a local structural check — is unchanged, so the assertion was
widened to the options object and a new assertion added pinning the supplied-profile-not-fallback
hand-off.

### Status

* Slices A, A.1, B, C, D — complete.
* Slice E (fact projection) and F (legacy cleanup) — next.
* Open migration finding: the three `tools.js` call sites above.

---

## Appendix E — Slice E results (2026-08-31)

Fact projection. **1668/1669 tests pass** (same single pre-existing failure).
`test/outerwearCapabilityProjection.test.js`, 8 tests.

### The audit changed where this had to land

§10's list opens with "wardrobe manifest", and the census first read that as one surface among
several — `tools.js` calls the manifest *"an index, not garment truth"* in two places. That reading
was wrong. Per [search-payload-spec.md](search-payload-spec.md) option B, the cached manifest line
is the **one home for stable garment truth**, and both retrieval tools deliberately stop re-sending
stable fields whenever it is present:

```js
// search_wardrobe, trimToJudgment branch — id/name/category/weatherFit/ruleFit and nothing else
// wardrobe_coverage
candidates: manifestCarriesTruth ? scoped.map(p => ({ id, name })) : scoped.map(wardrobeTruthRow)
```

So capability facts added only to the tool rows would have been invisible on the common path. The
manifest is where they had to go first.

### One shared helper, four projections

`outerwearCapabilityDisplay(piece)` returns display **values** (`'cold weather outerwear'`,
`'rain/wind'`, or `null`), never sentences. Each projection applies its own house format; none
decides what the values mean. That is §10's rule, and the reason for it is concrete: three
projections each writing their own gloss of `indoor_layer` is how one field acquires three meanings.

| Surface | Wiring | Format |
|---|---|---|
| `buildWardrobeManifestLine` | explicit | `outerwear role cold weather outerwear; protects against rain/wind` |
| `buildWardrobePieceTruthText` | explicit | `outerwear role: cold weather outerwear \| weather protection: rain/wind` |
| `wardrobeTruthRow` (above-cap) | explicit | raw canonical values |
| `search_wardrobe` untrimmed row | explicit | raw canonical values |
| `planWorkbenchPieceLine` | explicit | `outerwear_role:cold_weather_outerwear` |
| **~35 composer / capsule / critique / get_garment_details sites** | **inherited** | via `buildPieceText`, which is `buildWardrobePieceTruthText` |

That last row is the payoff. `buildPieceText` feeds the whole-wardrobe composer roster
(`rules.js:1466`, `:1526`), `get_garment_details` (`tools.js:2520`), the capsule and bench truth
catalogs (`routes/ai.js:4091`, `:4268`, `:4395`), and the selected/critique paths in `core.js` —
all of which gained the facts with no per-site change, because the projection was consolidated
rather than copied.

Only `planWorkbenchPieceLine` needed explicit wiring: it writes its own compact `key:value` line
instead of reusing the truth text, so it was the single model-facing surface that could not inherit.

### Deliberately NOT wired

* `pieceMatchBlob` / `structuredPieceSignalTokens` (`rules.js:1884`, `:1963`) — internal
  text-matching and mission-scoring blobs, not model-facing projections. §10's "do not add the
  fields blindly to unrelated contexts".
* `search_wardrobe`'s `trimToJudgment` branch — by design carries per-request judgment only; the
  manifest supplies the stable truth. Adding them there would re-transmit uncached what the cached
  line already holds, which is the exact cost regression option B was written to end.

### Pinned by test

Capability reaches the manifest, truth text, truth row and workbench line; an empty hazard list
prints no clause rather than an empty label; an untagged piece prints nothing; a stray role on a
non-outerwear piece never reaches the model (the category gate lives in the readers, so every
projection inherits it); and no projection editorialises — no "not suitable for", no "keep
indoors", nothing that duplicates Contract B's judgment in prose the code does not own.

### Status

* Slices A, A.1, B, C, D, E — complete.
* Slice F (legacy/special-case cleanup, incl. the `[A6]` capsule cardigan question) — next.
* Open migration finding: the three `tools.js` `evaluateWearableOutfit` call sites from D.4.
