# Spec 21 (v2, rewritten post-inventory): The cleanup PR — hermetic tests, dead-code sweep, trip-scope machinery, and the prose-parser ruling

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


**Status:** Proposed v2 (2026-07-17). Not implemented. **Supersedes the 2026-07-16 draft entirely** — spec 14 (PR #106) already deleted that draft's Part 1 (the whole precompose stack, its flags, its guard tests) and Part 4 (the plan-path diagnostics family), all confirmed gone by the spec-20 inventory (`docs/cleanup-inventory.md`, re-verified 2026-07-17 @ `1c9ce67`). What remains is smaller — but Part 1 below is a **live data-safety fix**, not just hygiene.
**Files touched:** 4 test files, `routes/ai.js` (one import line), `test/plan_outfit_set.test.js` (scaffolding), `styling-engine/provider.js` + `styling-engine/stylingIntent.js` + `styling-engine/tools.js` (trip-scope machinery), `src/components/StylistChat.jsx` + `dist/` (Part 4, conditional), `scratch/` + `.gitignore`, docs.

## Deletion doctrine (unchanged)

Delete-only PR — a `+` line outside tests/docs needs a second look (Part 1's isolation lines are the sanctioned exception). Every deletion cites its evidence (the inventory row or the owner ruling). Tests die with their subjects. Ratchet verified (likely unchanged — this surface is regex-light). Post-merge live smoke, three scenarios (Part 6).

## Part 1 — P0: stop four test files from writing to the live wardrobe.db

Inventory census 4B, the one live risk found: `test/occasion_exclusion.test.js`, `test/hot_weather_ranking.test.js`, `test/freeform_observability.test.js`, `test/visual_composer_roster.test.js` import `../db.js` **without setting `WARDROBE_DB_PATH`**, so they INSERT/UPDATE/DELETE against the developer's real closet data (e.g. `visual_composer_roster.test.js:324-328`). They currently pass because they clean up inline — one failed assert away from leaking rows into real data.

Fix: give each the same top-of-file tmpdir isolation every other DB-touching test already has (`process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')` **before** the `db.js` import), seed via the existing `test/helpers/dbFixtures.js` pattern where the tests relied on real rows. Inline cleanup blocks may stay or go — isolation makes them moot. Acceptance: `npm test` green AND `wardrobe.db`'s mtime unchanged by a full suite run.

## Part 2 — Mechanical dead-code sweep (inventory-confirmed, zero behavior change)

1. `routes/ai.js:55` — the unused `tripRequestNeedsScopeClarification` import (real call site is provider.js; this is a leftover from the deleted precompose logic). *(Subsumed by Part 3 if it executes first — either way the line dies.)*
2. `test/plan_outfit_set.test.js` — the ~23 lines of `WARDROBE_PLAN_COMPOSE` save/restore ceremony (module-level baseline at ~line 35 + per-test try/finally blocks). The flag has zero production reads since #106; every wrapped assertion already only checks model-mode behavior. Keep the tests, delete the ceremony.
3. `scratch/diagnose_anchor_selectivity.js` — tracked, whitelisted, referenced nowhere (inventory census 4C, verified by targeted grep). Delete the file AND its `.gitignore` whitelist line.

## Part 3 — Delete the trip-scope clause machinery (owner ruling 2026-07-15; the flag window has served its purpose)

The clause was retired behind `WARDROBE_TRIP_SCOPE_CLARIFICATION` in spec 18 Part 2 as a reversibility window. Evidence since: the flag was never flipped back on, and the model has repeatedly demonstrated the judgment the clause distrusted — unprompted, well-scoped venue/clarification questions in the 2026-07-16/17 wedding runs. Close the window:

- Delete the clause body in `applyFreeformOutputChecks` (provider.js:~177) and `tripScopeClarificationEnabled` (provider.js:~36).
- Delete `tripRequestNeedsScopeClarification` + `TRIP_ACTIVITY_OR_USE_CASE_PATTERNS` (stylingIntent.js:~90-106) and their unit tests.
- Delete the `tripScopeClarificationRetries` counter init (tools.js:~146), its bump site, and its `persistFreeformGenerationRun` write (the DB column stays — additive-only migrations).
- Delete the flag-on guard tests (aiEndpointContracts / freeform_observability, per inventory).
- **`destinationClarification` stays untouched** — no misfire evidence; it retires on its own evidence someday or not at all.

## Part 4 — CONDITIONAL (owner ruling attached): delete `parseStructuredOutfitsFromAssistantText`

The inventory's one "ambiguous — owner ruling needed" row: the call path is live (`StylistChat.jsx:3913`) but the function's own gate regex requires the pre-propose_outfit `### Outfit N` format that `STYLIST_SYSTEM` has forbidden since the migration — provider.js's contemporaneous comment: "that fallback silently never fires against current prose. There is no reliable local reconstruction path anymore."

**Recommendation: DELETE** — carrying a dead safety net is where this codebase's orphan code came from, and the real guarantee against unproposed outfit prose is now the server-side truth machinery (the `outfitProseWithoutToolCall` hard block), not a client-side parser for a format that cannot occur. Delete the function + simplify the empty-check at ~3911-3914 to the existing no-outfits fallback. **Frontend change → rebuild `dist/` in the same PR.**

If the owner rules KEEP instead: skip the deletion, add a dated comment at the function ("kept deliberately as a defensive net — owner ruling 2026-07-17; cannot match current prose format") so the next audit doesn't re-litigate it.

## Part 5 — Documentation hygiene

- One line in the README/`.env.example` (whichever exists): `WARDROBE_PLAN_PREROUTE`, `WARDROBE_BROAD_PLAN_PREROUTE`, `WARDROBE_FOLLOWUP_PREROUTE`, and `WARDROBE_PLAN_COMPOSE` no longer do anything (deleted with spec 14) — remove them from any local `.env`.
- Handoff doc: mark this spec's items done; note `docs/cleanup-inventory.md` as the evidence source; carry forward the inventory's two open flags verbatim (the devtools-only diagnostics UI gap — optional wiring, owner's call someday; and the scope note that rules.js/core.js/crud.js were NOT audited and need their own commissioned pass if ever wanted).

## Part 6 — Post-merge live smoke (owner, 3 scenarios)

(a) One budgeted capsule ask; (b) one set-modification follow-up ("make X dressier, add a rainy option"); (c) the anchored coverage-problem thread (the crop-top scenario, live-validated 2026-07-16): anchored cards with sight-based reasoning → honest layering pushback in text mode → under-layer pivot → exactly one render after image-intent re-declare. Scenario (c) is the guard for Part 4's StylistChat change. Green on all three = nothing live was touched.

## Explicitly out of scope (per the inventory's own dispositions)

All remaining diagnostics counters (census 3: every row is keep), all live config flags (census 2), the `isSmartCasualPlanSlot`-family keepers (census 1's "audit surprise" — load-bearing for normalization), untracked scratch/ working files, and any line-by-line audit of rules.js / core.js / crud.js (future commissioned pass, not this PR).

## Risks

Part 1 changes test plumbing only, with the wardrobe.db-mtime acceptance check as proof. Parts 2–3 delete code with zero production reads or an owner-ruled retirement plus post-retirement evidence. Part 4 is the only user-facing surface (hence conditional + the scenario-c smoke). Nothing here touches the plan/compose path that specs 23–27 just stabilized.
