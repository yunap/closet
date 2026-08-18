# Spec 20: Cleanup inventory — read-only reachability, flag, and diagnostics audit

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


**Status:** Proposed (2026-07-16). Not implemented.
**Priority:** Runs any time — it changes ZERO code, so it can run in parallel with spec 14. Its deliverable is the evidence base for every subsequent deletion spec (21+). Do not fold deletions into this spec.
**Files touched:** `docs/cleanup-inventory.md` (new — the only output), nothing else.

## Why an inventory first

This codebase's own history argues for it both ways: carrying dead layers is where its orphan code came from (a dead layer was already deleted once in the 2026-07-09 reachability audit), AND its worst regressions came from deletions/changes made on a wrong mental model of what was reachable (the gate-history doctrine: a missing/loose gate may be Decision A or Decision B — check before calling it dead). So: one read-only pass that makes reachability and evidence explicit, then deletion specs that cite it.

## The audit, four censuses

Scope: `styling-engine/*.js`, `routes/*.js`, `src/components/*.jsx`, `server.js`, `db.js`, `test/*`, `scratch/*` (scripts referenced by npm test only).

### 1. Export/function reachability census

For every exported symbol (and every 50+ line internal function) in `styling-engine/` and `routes/`, classify:

- **LIVE** — reachable from a route handler, tool executor, or test that guards live behavior.
- **FLAG-ONLY** — reachable only when a non-default env flag is set (name the flag).
- **TEST-ONLY** — imported only by tests (the subject may be a deletion candidate; the test certainly is if the subject dies).
- **DEAD** — no reachable call path at all.

Method: start from the entry points (`server.js` route registrations, `executeTool`'s switch, the React component tree from the app root) and walk imports/calls; do NOT classify by grep-count alone — a symbol referenced only by its own test is not live. Known seeds to verify (do not assume, verify): `maybePrecomposeUseCasesForAsk` / `maybePrecomposeStructuredFollowupForAsk` (flag-only since 2026-07-14), `USE_CASE_PLANNER_SYSTEM`, `planFreeformUseCases`, `shouldEngageAskPrecompose`, `tripRequestNeedsScopeClarification` (flag-only since PR #104), `parseStructuredOutfitsFromAssistantText` in StylistChat.jsx (~line 1321 — documented in provider.js as unable to match current prose format since the propose_outfit migration; verify its call site at ~3913 can still fire and what would render if it did), and whatever spec 14 left of `composeOutfitSet`'s callers.

### 2. Env-flag census

Every `process.env.WARDROBE_*` / behavior flag: name, default, what it gates, every read site, and its evidence status — one of "retired with evidence (date, canary)", "retired awaiting evidence", "live config". Known population to start from: `WARDROBE_PLAN_PREROUTE`, `WARDROBE_BROAD_PLAN_PREROUTE` (legacy alias), `WARDROBE_FOLLOWUP_PREROUTE`, `WARDROBE_TRIP_SCOPE_CLARIFICATION`, `WARDROBE_PLAN_COMPOSE` (now default model; engine value's fate belongs to spec 14), `PHOTO_PRESERVING_VISUALS`, `AI_PROVIDER` and model overrides, `WARDROBE_DB_PATH`.

### 3. Diagnostics-counter census

Every `bumpFreeformDiagnostic` field and the plan-path diagnostics (`planKeywordMatched`, `planPrerouteComposed`, `planModelCalled`, `planPathOutcome`, `followupPathOutcome`, `tripScopeClarificationRetries`, …): who reads it (UI debug block? tests? nothing?), and whether the question it was built to answer is now settled. A counter whose question is answered (e.g. pre-route retirement evidence — the routes are retired) is a deletion candidate WITH its plumbing; a counter still consumed by the "Search & validation details" panel stays.

### 4. Test and scratch hygiene census

- Tests whose subject is FLAG-ONLY or DEAD (they become deletions alongside their subjects in later specs — list them now).
- Non-hermetic tests: anything reading untracked files (`scratch/` scripts — the 9 known env-dependent failures from the PR #105 report, if spec 14's Step 0 hasn't already fixed them), anything date-sensitive (the hot-weather fixtures), anything reading the live `wardrobe.db`.
- `scratch/` scripts not referenced by `package.json` scripts or docs.

## Deliverable format

`docs/cleanup-inventory.md`: one table per census, each row = symbol/flag/counter, classification, evidence pointer (file:line + the handoff-doc section or PR that retired it), and a proposed disposition (`delete in spec 21`, `delete when X evidence lands`, `keep`, `owner ruling needed`). End with a proposed sequence of deletion specs grouped so each spec is one family in one PR. Flag every "owner ruling needed" row prominently — per the gate-history doctrine, ambiguous rows are questions, not deletions.

## Hard rules

- Zero code changes, zero test changes, zero deletions — report only.
- Verify every claim by reading the call path, not by grep count.
- Where spec 14's in-flight PR affects a row (it deletes the scorer layer and possibly `composeOutfitSet` + pre-routes), classify against spec 14's final merged state — coordinate by reading its merged diff, not its spec.
