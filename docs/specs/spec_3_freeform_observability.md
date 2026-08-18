# Spec 3/3: Observability parity for freeform chat

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


**Status:** Implemented (2026-07-09). Parts 1–3 built as specced; Part 4 deliberately skipped (see note below).
**Priority:** Medium — not urgent on its own, but closes the detection gap that let the board-mismatch bug go unnoticed until manually caught
**Files touched:** `styling-engine/tools.js` (`bumpFreeformDiagnostic`, `propose_outfit`/`search_wardrobe` handlers), `routes/ai.js` (`persistFreeformGenerationRun`, `/ask` response), `db.js` (`freeform_generation_runs` table), `src/components/StylistChat.jsx` (collapsed details affordance), `src/App.css` (reused existing `.telemetry-details`), tests

## Implementation notes (2026-07-09)

- **Part 1:** `propose_outfit`'s role-validation failure path (tools.js) now pushes a broken diagnostic card — `{ broken: true, rejectionReason, pieceIds, pieces }` — into `toolContext.generatedOutfits` in addition to returning the error to the model. This reuses the **exact existing** composer "needs review" rendering in `StylistChat.jsx` (`isBrokenCard` check at renderStructuredAdvice, ~line 1965) with zero client changes needed for the card itself — the client already treats `outfit.broken` as a diagnostic card. Unresolved-ID errors (piece IDs that don't exist) are NOT given a broken card — only role/slot validation failures, since an ID that doesn't resolve has no real piece list to show.
- **Part 2:** `toolContext.freeformDiagnostics` (via `bumpFreeformDiagnostic`) accumulates `searchCalls`, `gateExcludedTotal`, `proposeCalls`, `proposeValidationFails` across every tool call in a turn. Surfaced client-side as a single collapsed "ⓘ Search & validation details" `<details>` per message (not per-card, to keep scope tight), reusing the existing `.telemetry-details` CSS class verbatim — only rendered when there's something to show (nonzero exclusions/failures).
- **Part 3:** New `freeform_generation_runs` table (parallel to `generation_runs`, since composer-shaped columns like `pool_size`/`cap_applied` don't apply). `persistFreeformGenerationRun` (exported from `routes/ai.js`, best-effort/non-throwing) is called once per `/ask` request. `weather_source` column exists but is unpopulated until spec 4 (live weather) lands — nothing to report yet. `session_id` is accepted but not yet wired to a real thread/session identifier from the client — the /ask request body has no such field today; left as a hook for later, not blocking since aggregate (non-per-thread) numbers already answer "how often does X happen."
- **Part 4 (rationale/structure consistency check) — deliberately NOT implemented.** Per the earlier design review: spec 3 itself argues the prose-to-structure gap is gone by construction once `propose_outfit` is the only path, which undercuts the case for a string-containment check between prose and resolved piece names. That kind of heuristic is exactly the class of brittle detection this whole arc has been retiring elsewhere (synonyms, generic descriptions → false positives), and it would erode trust in the diagnostic surface it's supposed to strengthen. Skipped; can be revisited if real drift of this kind is later observed.

---

## Finding

When the composer misbehaves, the diagnostic broken-card system (built earlier this arc) surfaces it immediately: labeled "NEEDS REVIEW," reject reason, roster counts, resolved activity/register — all visible without any manual detection work. When freeform chat misbehaves — the board-mismatch bug this session — nothing flags it. The only reason it was caught was a human reading the rationale prose closely enough to notice it disagreed with the rendered board. That's not a repeatable detection method.

## Part 1 — Validation failures surface, don't silently fall back or drop

Once `propose_outfit` (spec 2) exists with real validation (role/slot rules), a failed validation should render as a visible diagnostic state in the chat — same spirit as the composer's broken-card treatment — rather than silently retrying, dropping the proposal, or (worse) rendering something that doesn't match what was proposed. Reuse the composer's `NEEDS REVIEW` visual treatment where it fits.

## Part 2 — Gate-exclusion visibility in chat

When `search_wardrobe` (spec 1) excludes prohibited-tier pieces from compose-intent results, log what was excluded and why — surfaced the way the composer's roster debug shows `excludedCounts`. Doesn't need to be in the user-facing chat by default (that would clutter conversation), but should be inspectable — e.g., a small "ⓘ" affordance near a proposal showing what the search behind it filtered out, mirroring the composer card's collapsed-by-default detail pattern from the card-density spec.

## Part 3 — Per-thread instrumentation

Extend `generation_runs` (or add a parallel table if freeform chat's shape doesn't fit cleanly) to log: `propose_outfit` calls per thread, validation pass/fail counts, gate-exclusion counts, whether live weather resolved or fell back. This makes freeform chat's health queryable the same way composer runs already are — "how often does validation fail," "how often does weather fall back to heuristic" become answerable questions instead of anecdotes, consistent with how `generation_runs` already serves that role for the composer.

## Part 4 — Rationale/structure consistency check (defense in depth)

Even with structured proposals, add one lightweight consistency check: if the model's conversational prose (outside the tool call) names a specific garment that doesn't appear anywhere in the same turn's `propose_outfit` pieces, flag it — this is exactly the class of bug that was caught by chance this session (prose said "floral tunic," board didn't have it). With structured output this should be rare (there's no more prose-to-structure gap to fall into), but a String-containment check between rationale text and resolved piece names is cheap insurance against a different kind of drift (e.g., the model narrating a piece it forgot to include in the tool call).

## Tests

1. ✗ A validation failure (spec 2's role/slot rules) renders a visible diagnostic state, not a silent drop.
2. ✗ Gate-exclusion detail is logged and inspectable per proposal.
3. `generation_runs` (or equivalent) captures freeform-chat proposal outcomes queryable the same way composer runs are.
4. Rationale/structure mismatch check: a fixture where prose names an unresolved piece flags it; a clean match doesn't false-positive.

## Out of scope

- Any change to gate logic itself (spec 1) or proposal structure (spec 2) — this spec only makes their outcomes visible.
- Composer-side observability — already correct, unchanged.
