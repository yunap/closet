# Spec 28: Commissioned inventory of the unaudited surfaces (whole-app cleanup, phase-structured)

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


**Status:** Proposed (2026-07-17). Not implemented. Read-only — ZERO code changes; the deliverable is documentation. Each phase is an independent session and an independent append to `docs/cleanup-inventory.md`.
**Method:** identical to spec 20 (the proven pattern): reachability verified by walking actual call paths from entry points — never grep-count; four censuses (reachability, flags, counters where applicable, test/fixture hygiene); every row gets a disposition (`delete in next spec` / `keep` / `owner ruling needed`); ambiguous rows are questions, not deletions. Baseline: current `origin/main` (post-spec-21; suite 577+/577+ green and hermetic — verify before starting).
**Why now:** the freeform arc's deletions (specs 14, 21) changed the call graph INTO these files — branches that only the deleted engine composer called are now unreachable with nobody having audited them — and the pre-inversion pipelines have never had a reachability pass at all. The spec-20 inventory's own scope note commissions exactly this.

## Entry points (all phases walk from these, nothing else counts as "reachable")

`server.js` route registrations → `routes/*.js` handlers; `executeTool`'s switch (`styling-engine/tools.js`); the React component tree from the app root (`src/`); `package.json` scripts; `scratch/` files whitelisted in `.gitignore` or referenced by tests/docs.

## Standing cautions (read before classifying ANYTHING as dead)

1. **Pre-inversion ≠ dead.** The Visual Composer selected-item flow (`generateOutfitsForPieceInternal` — "AI stylist composer"), the outfit evaluator, boards, renders, and the tagger are LIVE product features that predate the freeform arc. The audit classifies; it does not assume the old world died with the new one.
2. **Deliberate-decision traps** (from the project's recorded rulings — check `docs/freeform-rearchitecture-handoff.md` and the gate-history record before flagging):
   - `repairWholeWardrobeOutfit` is **intentionally skipped** for LLM-composed advisor-mode outfits (owner decision, recorded). Its absence from a path is a ruling, not dead code.
   - Any missing/loose gate may be Decision A (wanted, not built) or Decision B (deliberately loosened). Flag as `owner ruling needed`, never as `delete`.
3. **Additive-only migrations**: inert DB columns are awareness rows, not deletion candidates.
4. Known seed from the arc's own notes: `buildWholeWardrobeCandidateOutfits` had three call sites in `routes/ai.js` outside `plan_outfit_set` that were explicitly "NOT touched or audited" — start Phase 1's rules.js walk there.

## Phase 1 — `styling-engine/rules.js` + `styling-engine/core.js` (highest yield, do first)

The two biggest files (~4,500 and ~3,700 lines), serving both deleted and surviving consumers. Specific hunting grounds:

- Scorers, candidate builders, and mission machinery (`qualifiesWholeWardrobeMission`, `capsuleVersatilityScore` cousins, whole-wardrobe scoring families) whose remaining callers may be only the deleted `composeOutfitSet` path — walk each exported symbol's callers from the entry points.
- The evaluator/boards/render pipelines in core.js: classify LIVE (they are product features) but note internal branches orphaned by parameter changes over the arc.
- `softScoreFloors.js`, `attributes.js`, `occasions.js`, `weather.js`, `taggerMerge.js` ride along in this phase (small files, same consumers).
- Census 2 (flags) and census 4 (fixtures/hygiene) applied to this surface; census 3 (counters) only if new counters live here.

## Phase 2 — `routes/ai.js` (non-freeform routes) + `routes/crud.js` + `server.js` + `db.js`

The older pipelines' server surface: every route handler classified LIVE (frontend actually calls it — verify against the frontend's fetch sites, not assumption), FRONTEND-ORPHANED (route exists, no caller in src/), or DEAD. Include: upload/photo paths, tagger endpoints, board/evaluation endpoints, any route whose only caller was a deleted UI element. Flag frontend-orphaned routes as `owner ruling needed` (they may serve manual/curl workflows the owner uses).

## Phase 3 — frontend beyond StylistChat (`src/`)

Component reachability from the app root: unused components, unreferenced props/state, dead conditional branches keyed to server fields that no longer exist (e.g. anything reading deleted diagnostics fields). Two carried-forward open items to resolve as rows here: the devtools-only diagnostics UI gap (spec-20 census 3 flagged it — render-all vs deliberate developer channel, owner ruling), and any residue around the prose-parser deletion site if spec 21 Part 4 executed. `dist/` is generated — never audit it, note only that it must be rebuilt by whichever deletion spec follows.

## Deliverable per phase

Append a dated section to `docs/cleanup-inventory.md` in the established table format, ending with a proposed deletion-spec grouping for that phase's findings (one family per PR, per the deletion doctrine). Commit the doc — nothing else. If a phase finds a live data-safety issue (spec 21 Part 1's class), flag it P0 at the top of the section rather than burying it in a table.

## Risks

None to the app — read-only. The risk is auditor overreach: classifying deliberate decisions as dead (mitigated by the standing cautions) and scope creep into fixing things mid-audit (forbidden — findings become the next spec, never inline edits).
