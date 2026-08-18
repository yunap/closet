# Spec 12: Structured slot semantics — the model declares environment/activity; prose classifiers demote to counted fallbacks

> ## ⚠️ HISTORICAL ARCHIVE — NOT A DESIGN AUTHORITY
>
> This spec is a **frozen record of intent at the time it was written**. It spans generations of an
> app that has been redesigned several times, and decisions in it have been revisited, reversed, or
> deleted since.
>
> **The `Status:` line below is frozen at authoring time and is frequently WRONG today.** Several
> specs marked "Proposed. Not implemented." shipped long ago (spec 29, 32 and 33 all say this, and
> all are merged).
>
> **Authority order when this disagrees with anything (owner ruling, 2026-07-30):**
> **1. the code** — what actually runs · **2. ratified docs**
> ([occasion profiles](../occasion_profiles_ratification.md), [style constitution](../style_constitution.md),
> the three maps) · **3. this archive** — only *why* something was once done that way.
>
> A decision made from fresh evidence — a live run, a measurement — **stands**. "An old spec decided
> otherwise" is an **unverified claim, not a finding**. Record the disagreement and let testing
> settle it; do not revert working behaviour on the strength of this file.
>
> Read [docs/specs/README.md](README.md) before acting on anything below.


**Status:** Proposed (2026-07-15). Not implemented.
**Priority:** High, and cheap — this is the "stop the bleeding" spec. It ships alone, before and independently of spec 13.
**Files touched:** `styling-engine/tools.js` (plan_outfit_set schema), `styling-engine/outfitSetPlanner.js` (`normalizePlanSlots`, `normalizePlanSlotOccasion`, `normalizePlanSlotEnvironment`, `inferPlanSlotActivity`), diagnostics plumbing, tests.

## Finding

The freeform re-architecture's core thesis was: the model declares structure in tool args; deterministic code stops regex-sniffing meaning out of prose. `plan_outfit_set` violates this one layer down. Three prose classifiers now run inside `normalizePlanSlots` ([outfitSetPlanner.js:2032](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/outfitSetPlanner.js:2032)):

1. **`normalizePlanSlotEnvironment`** (PR #94) — regex-matches `beach|pool|swim|coast|seaside|oceanfront|shore|sand` against slot label/best_for/coverage/plan_note/location to tag `environment: 'beach_coastal'`. The model has NO structured way to say "this is a beach slot" — `environment` is not in the tool schema (verified 2026-07-15: `grep environment styling-engine/tools.js` → no schema hits).
2. **`inferPlanSlotActivity`** (PR #95) — when the model omits `activity`, regexes over slot prose infer `walking`/`hiking`, with a gallery/museum/dinner *exclusion* regex bolted on so elevated slots don't get flattened into walking shoes. This is the pre-inversion router pattern reborn: prose in, regex classification, exception list growing per incident.
3. **`normalizePlanSlotOccasion`** (PR #93) — rewrites `outdoor_daytime_social` → `casual` when the prose "looks like beach," via `textLooksLikeBeachPlanSlot`.

Each was a correct *incident* fix. Structurally, they're all the same miss: the model knew the slot was a beach/walking slot when it wrote the label — the schema just never asked. Every future environment (ski, sailing, festival, rain) grows the regexes and their exclusion lists.

## Part 1 — Add `environment` to the slot schema; require `activity`

In `STYLIST_TOOLS`' plan_outfit_set slot item schema ([tools.js:507-522](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/tools.js:507)):

```js
environment: {
  type: "string",
  enum: ["indoor", "outdoor", "beach_coastal"],
  description: "The slot's physical setting. 'beach_coastal' for beach, pool, seaside, or coastal-outing slots — it drives sand/water/wind handling and overrides a contradictory weather:'indoor'. 'indoor' for climate-controlled slots (offices, restaurants, galleries). Omit when unsure; 'outdoor' is the default."
},
```

And change the slot `required` array from `["label", "occasion"]` to `["label", "occasion", "activity"]`. `activity` already has the enum (`none|walking|hiking`, [stylingIntent.js:2](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/stylingIntent.js:2)) and a good description; requiring it forces the model to make the walking/none call it was already making implicitly in prose. The PR #95 live bug ("City Walking Days" with `best_for:"walking around the city"` but no `activity`) is exactly an omission this closes at the contract level.

**Why an enum is not "the new special-casing":** an enum value is data the model fills — the same shape as `occasion`, which has scaled fine through the whole gate arc. Adding a future environment costs one enum entry plus whatever *constraint* semantics it carries (e.g. the indoor-weather contradiction). What it must NOT carry is a taste scorer — that's spec 13's job to relocate. Keep this enum minimal (3 values); do not pre-invent ski/rain/etc. until a live scenario needs one.

## Part 2 — Declared values win; prose inference becomes a counted fallback

In `normalizePlanSlots`:

```js
const declaredEnvironment = normalizePlanEnvironment(slot?.environment)   // enum-or-'' normalizer, new
const environment = declaredEnvironment ||
  normalizePlanSlotEnvironment({ label, bestFor, coverage, planNote, location })
if (!declaredEnvironment && environment) bumpFreeformDiagnostic(toolContext, 'planSlotEnvironmentInferred')
```

Same shape for activity: explicit `slot.activity` (now schema-required) wins; `inferPlanSlotActivity`'s prose regexes only run when it's missing/`none`-with-walking-prose, and bump `planSlotActivityInferred` when they change the value. (`normalizePlanSlots` doesn't currently receive `toolContext` — thread a `diagnostics` callback or the counters object through its options; the executor at [tools.js:1393](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/tools.js:1393) has `toolContext` in scope.)

The PR #93 occasion rewrite becomes structural: `if (occasion === 'outdoor_daytime_social' && environment === 'beach_coastal') return 'casual'` — driven by the resolved environment, not its own separate regex. `textLooksLikeBeachPlanSlot` survives only inside the fallback inference. `beachCoastalStatedWeather`'s indoor-contradiction guard (PR #95) needs no change — it already keys off `environment`, which is now declared-first.

## Part 3 — The retirement play (same as the pre-routes, #74/#83)

The prose classifiers don't get deleted in this spec — they get demoted and *measured*. When live diagnostics across the scenario families show `planSlotEnvironmentInferred` / `planSlotActivityInferred` at ~0 (the model reliably declares), delete the regexes in a follow-up. This is the exact evidence-gated retirement pattern that worked for the keyword pre-routes. If the counters stay hot, that's evidence too — it means schema + description weren't enough and we keep the fallback (the specs-3/7/11 lesson: prompt/schema guidance alone isn't always reliable; the mechanical fallback stays until proven idle).

Persist both counters as columns in `freeform_generation_runs` following the established `persistFreeformGenerationRun` pattern (db.js CREATE + migration), so the retirement evidence survives restarts.

## Tests

- Schema assertions: `environment` enum present, `activity` in `required` (string-presence tests per the spec-6 pattern).
- `normalizePlanSlots` unit tests: declared `environment:'beach_coastal'` wins with zero prose signals; omitted environment + coastal prose still infers AND bumps the counter; declared `environment:'indoor'` suppresses coastal inference from a "Shoreline Dinner" label (declared-wins precedence).
- Occasion rewrite: `outdoor_daytime_social` + declared `beach_coastal` → `casual` with NO beach words anywhere in prose (proves it's structural now).
- Activity: schema-required value passes through untouched (no inference counter bump); the PR #95 "walking around the city" repro still infers when activity is absent (fallback intact).
- Existing `test/plan_outfit_set.test.js` beach cases must stay green — they exercise the fallback path, which this spec keeps.

## Risks

Low. Declared-wins is additive; every existing behavior survives as the fallback. The one behavioral edge: a model that declares `environment` *wrongly* (e.g. `beach_coastal` on a dinner slot) now beats the prose. That is the correct trade — it's the same trust we already extend to `occasion`/`register`/`weather` args, and the constraint gates still apply regardless.
