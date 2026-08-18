# Spec 29: Post-audit fixes — the trimmed-pieces gate bypass (P0), the fifth non-hermetic test (P0), and the audited dead-code sweep

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


**Status:** Proposed (2026-07-17). Not implemented. All owner rulings collected 2026-07-17 and encoded below — nothing conditional remains. Evidence source for every item: `docs/cleanup-inventory.md`, "Spec 28 audit" section.
**Priority:** Parts 1–2 are the P0s (a live data-quality bug in the Visual Composer flow, and a live data-safety exposure in the test suite). Parts 3–7 are the audited mechanical cleanup. One PR; Part 1 gets its own commit first.
**Files touched:** `styling-engine/rules.js`, `styling-engine/attributes.js`, `styling-engine/core.js`, `routes/ai.js` (one response field), `test/threadRail.test.js`, one new regression test, `src/` (9 files deleted, 1 pruned) + `dist/` rebuild, docs.

## Part 1 — P0: rehydrate pieces inside `locallyGateWholeWardrobeOutfits` (owner ruling: fix in the gate)

The audit's Phase 1 P0: `normalizeWholeWardrobeOutfitObject` (`rules.js:~3782`) trims resolved pieces to `{id, name, category, photo, worn_photo}`, so on both `/evaluate-piece` candidate paths (`routes/ai.js:~1804, ~1816`) every structured gate downstream — `registerCeilingVerdict`, `footwearComfortVerdict`, prohibited-material/footwear checks — reads `undefined` and silently degrades to name-text matching. Second live occurrence of the bug class the arc already fixed once in the planner.

**Fix (per ruling):** inside `locallyGateWholeWardrobeOutfits` (`rules.js:~4349`), before the `profileFits` computation, map the outfit's `.pieces` back to the full objects in `candidatePieces` by id (the `rehydrateOutfitPieces` precedent from the old planner fix — same shape, same rationale). Every caller gets the fix automatically, regardless of `repair`/`advisorMode`; no payload/response shape changes; the deliberate no-repair-in-advisor-mode ruling is untouched.

**Regression test (required, from the audit's census 4 gap):** a test that runs the REAL production sequence — DB-shaped full pieces → `normalizeWholeWardrobeOutfitObject` → `locallyGateWholeWardrobeOutfits` — and asserts a dressy piece trips the register ceiling and a high-heel trips the footwear verdict. **Verify the test FAILS against pre-fix code before landing the fix** (the existing fixtures pass for the wrong reason; this one must not).

## Part 2 — P0: hermeticize `test/threadRail.test.js`

Fifth non-hermetic DB test (audit Phase 2 P0): static import chain reaches `db.js` with no `WARDROBE_DB_PATH` override, exposing the real closet DB to the module-load `tag_state` backfill (`db.js:~289-316` — live, wanted app behavior; the hazard is the ungated test import). Apply the exact dynamic-import-after-env-var pattern from spec 21 Part 1. Acceptance: full `npm test` run leaves `wardrobe.db`'s mtime unchanged (now guaranteed structurally, not by data luck).

## Part 3 — Mechanical dead-code sweep (audit-confirmed, zero behavior change)

1. Remove the ~60 unused `rules.js`-sourced imports from `core.js:41-122` (the audit's full list is authoritative — re-verify each with a word-boundary grep before deleting, per the doctrine).
2. Delete dead functions: `wholeWardrobeSelectionScore` (`rules.js:~3010`), `buildCompactPieceText` (`core.js:~209`), `getPiecePhotoPath` (`core.js:~3359`), `getCalibrationSourcePhotoPath` (`core.js:~3374`), `setPath` (`taggerMerge.js:~168`). All audited zero-caller, zero-test-coverage.
3. Delete the always-null `structuredOutfitsDebug` field from the `/ask` response (`routes/ai.js:~2742`) — Phase 3 confirmed zero frontend reads.

## Part 4 — Delete the identity-feedback family (owner ruling: never shipped)

Delete all 7 files: `src/constants/feedback.js`, `src/constants/identityFeedbackChips.js`, `src/utils/feedbackMessages.js`, `src/utils/feedbackRouting.js`, `src/utils/identityFeedback.js`, `src/utils/identityLearning.js`, `src/styles/feedback.css`. Audit evidence: zero imports anywhere, single initial commit each, superseded by the live two-label system (`OUTFIT_FEEDBACK_LABELS`, pinned by `test/feedback_redesign.test.js` — which must stay green untouched).

## Part 5 — VisualLab cleanup (owner ruling: delete the dead branch)

Remove the never-supplied `activeContext` prop, its unreachable per-context empty-state branch (`VisualLab.jsx:~58, ~474`), and the stale doc comment (lines ~50-56) describing props that no longer exist. Visual Lab is a standalone tab by design.

**Parts 4–5 are frontend → rebuild `dist/` in the same PR** (repo convention).

## Part 6 — Rename `attributes.js`'s `pieceTextBlob` (owner ruling: rename only, no consolidation)

Rename to `attributePieceTextBlob` (internal to `attributes.js` — audit confirmed zero external importers of this copy) and update its in-file call sites. Kills the identical-name footgun with byte-zero behavior change. Consolidation is explicitly deferred — it would change what the matching gates see and needs its own evidence-backed pass.

## Part 7 — Documentation closures

- `docs/cleanup-inventory.md`: mark this spec's rows executed; record the devtools-diagnostics ruling as **CLOSED — affirmed keep-as-is** (deliberate developer channel; two audits concurred, owner affirmed 2026-07-17) so it is never carried forward again.
- Handoff doc: dated section noting the audit arc is complete (spec 20 → 21 → 28 → 29) and every app surface has been walked.

## Acceptance

`npm test` fully green including the new Part 1 regression test (verified red-before-fix); `wardrobe.db` mtime unchanged by a suite run; ratchet verified; **live smoke: one `/evaluate-piece` turn** (select a piece → "Style this piece") — expect the gates to actually fire now, which may visibly mean *stricter* candidate filtering than before. That's the fix working, not a regression: pre-fix, dressy pieces and uncomfortable shoes were slipping through as "unknown."

## Risks

Part 1 is the only behavior change, and it's the intended one — `/evaluate-piece` results may tighten (previously-ungated pieces now correctly excluded or flagged). Everything else is audited-dead deletion, a rename with zero external callers, or test plumbing. Nothing touches the freeform plan path.
