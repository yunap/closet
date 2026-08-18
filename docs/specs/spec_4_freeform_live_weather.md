# Spec 4: Live weather for grounding gates (split out of spec 1 Part 3)

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


**Status:** Implemented (2026-07-09). Design decisions below (resolves the open questions the original doc flagged for review).

## Implementation notes (2026-07-09)

- **Provider: [Open-Meteo](https://open-meteo.com)** (geocoding + forecast), chosen specifically because it requires **no API key** — sidesteps the "API key via env" open question entirely; nothing to sign up for, no secret to manage, no missing-config mode to worry about beyond "no location given yet."
- **Location resolution:** no stored user home-location exists anywhere in the app today (checked — no `location`/`city` field on any table or in `toolContext`). Rather than invent that as part of this spec, `search_wardrobe` gained a new optional `location` tool param (same class of param as `weather`/`activity` — the model supplies it when a real destination is established in conversation, e.g. trip planning), with `toolContext.location` as a carryover fallback for the rest of the turn. **Until a location is mentioned, live weather never activates and the system correctly runs on the heuristic** — this is the "missing config" resilience path working as designed, not a placeholder.
- **Date:** `toolContext.currentDate` (populated from `req.body.currentDate` in `/ask`, which the client already sends on some paths via `currentChatDateContext()`) or defaults to server `new Date()`.
- **Test isolation:** mirrors `provider.js`'s existing `takeTestAiResponse` convention (`process.env.NODE_ENV !== 'test'` gate) — live resolution is skipped entirely under `node --test` unless a test explicitly injects its own `fetchImpl`, guaranteeing the automated suite never depends on real network access.
- **Range classification is non-exclusive; single-day is exclusive.** `weatherProfileFromContext`'s original contract treats `isHot`/`isCold` as mutually exclusive (a single day is rarely legitimately both). A multi-day trip range genuinely can span both extremes, so `getWeatherProfileForPlan` allows both flags true simultaneously — useful for packing ("this trip needs both linen and a layer").
- **Files:** new `styling-engine/weather.js` (`getCurrentWeatherProfile`, `getWeatherProfileForPlan`, in-memory 3-hour cache for geocode + forecast lookups); `styling-engine/tools.js` (`search_wardrobe` wiring, `location` tool param, `setFreeformWeatherSource`); `routes/ai.js` (`location`/`currentDate` threaded into `/ask`'s `toolContext`). `freeform_generation_runs.weather_source` (added in spec 3, previously always empty) is now actually populated. Tests: `test/weather.test.js` (11) + 1 wiring test in `test/freeform_observability.test.js`. Full suite 340 green, build OK.

---

**Status (original):** Ready for design — **greenfield, not a port.** Code audit (2026-07-08) confirms `getCurrentWeatherProfile`/`getWeatherProfileForPlan` have **zero references anywhere** in the repo. The earlier "live-weather spec" was never implemented. This spec builds that integration for the first time, with `search_wardrobe`/`profileRuleFit` as its first consumer.
**Priority:** Medium — real improvement, but not on the critical path for closing the register/footwear grounding gap (specs 1–2 do that with the existing `weatherProfileFromContext` text heuristic).
**Why this is its own spec (moved out of spec 1):** spec 1 is deliberately a fast, mechanical port of existing composer logic into `profileRuleFit`. Live weather is an external-dependency build (a weather API, date/location resolution, caching, failure/fallback modes) — the opposite of mechanical. Bundling it made spec 1 blockable by an integration that doesn't exist yet. Kept separate so specs 1–2 can ship immediately.
**Files touched:** new weather module (fetch + profile mapping), `tools.js` (`search_wardrobe` weather resolution), `rules.js` (`profileRuleFit` weather input), config/env for API key + location, tests.

---

## Finding

`search_wardrobe` (and `profileRuleFit`) currently derive weather from `weatherProfileFromContext({ season })` — a text heuristic over free-form season/mood strings ([rules.js:48](../styling-engine/rules.js:48)). There is no live weather anywhere in the codebase. This is fine as a floor, but it can't distinguish "an unusually cold day in a warm month" from the seasonal average, so heat/cold gating can be wrong on the days it matters most.

## Part 1 — Weather module (build, don't port)

New module exposing:
- `getCurrentWeatherProfile({ date, location })` → resolves to the same `{ isHot, isCold, ... }` shape `weatherProfileFromContext` already returns, so it is a drop-in for every existing consumer.
- `getWeatherProfileForPlan({ dateRange, location })` → for trip/multi-day planning.

Design requirements:
- **Same output contract** as `weatherProfileFromContext` (the gates consume `isHot`/`isCold` today) — new inputs, identical outputs, so `profileRuleFit` needs no shape change.
- **Resilient fallback:** on API failure/timeout/missing-config, fall back to `weatherProfileFromContext` and mark the source (`weatherSource: 'live' | 'heuristic'`) so spec 3's observability can log fall-back rate.
- **Caching:** cache by (date, coarse location) to avoid per-piece or per-turn API hammering (`profileRuleFit` runs once per candidate piece).
- **Config:** API key via env; location resolution strategy (user profile setting vs request-supplied) decided in design review.

## Part 2 — Wire into `search_wardrobe`

Replace the `weatherProfileFromContext({ season })` call at [tools.js:282](../styling-engine/tools.js:282) with live resolution + heuristic fallback, threading the same date/location resolution the composer would use. `profileRuleFit` already accepts `weatherProfile` in its options — no change needed there beyond receiving the live-resolved profile.

## Tests
1. Live weather resolves for a `search_wardrobe` call with date/location context and drives `isHot`/`isCold` correctly.
2. API failure falls back to `weatherProfileFromContext`, sets `weatherSource: 'heuristic'`, and never throws into the tool call.
3. Cache: two calls for the same (date, location) hit the API once.
4. `profileRuleFit` behaves identically given a live vs heuristic profile of the same `isHot`/`isCold` (contract parity).

## Out of scope
- The register/footwear enum gates (spec 1) — they work today on heuristic weather; live weather only improves their input.
- Structured proposals (spec 2), observability (spec 3, though it will *log* `weatherSource`).
