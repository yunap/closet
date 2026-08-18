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


**Status:** Ready for implementation once spec 2 lands (depends on `propose_outfit`'s structured shape to have anything meaningful to instrument — building this against prose output would be re-diagnosing the problem spec 2 removes)
**Priority:** Medium — not urgent on its own, but closes the detection gap that let the board-mismatch bug go unnoticed until manually caught
**Files touched:** `tools.js` (`propose_outfit` handler), `StylistChat.jsx` (render diagnostics), `generation_runs` (or equivalent logging table), tests

---

## Finding

When the composer misbehaves, the diagnostic broken-card system (built earlier this arc) surfaces it immediately: labeled "NEEDS REVIEW," reject reason, roster counts, resolved activity/register — all visible without any manual detection work. When freeform chat misbehaves — the board-mismatch bug this session — nothing flags it. The only reason it was caught was a human reading the rationale prose closely enough to notice it disagreed with the rendered board. That's not a repeatable detection method.

## Part 0 — Two findings from live testing (2026-07-09), reordering priority within this spec

Live conversation logs caught the exact failure class this spec exists to prevent, at two severities:

**0a. Outfit-shaped prose with no `propose_outfit` call.** Across one multi-turn "give me another outfit" exchange, the model complied on turn 1 (`propose_outfit` called correctly), then produced two consecutive fully-formed outfit proposals (title, Top/Bottom/Shoes/Accessory, rationale) as **plain prose with zero tool calls**, before snapping back to compliance on a third. This is intermittent, not systemic — the tool works and is used correctly most of the time — but "the model felt like using it this turn" is not a property the system should depend on.

*Detection, added to Part 1 above:* pattern-match assistant text for outfit-shaped structure (a labeled title followed by Top:/Bottom:/Shoes:/Accessory: or equivalent bullet pattern) with no corresponding `propose_outfit` call in that turn. Flag it — and per the severity below, for the worse case, more than flag it.

**0b. Zero-result search contradicted by the very next response — hard block, not passive logging.** The log shows `search_wardrobe({"query":"Turquoise Linen Button-Up Shirt"})` returning `0 items`, immediately followed by the model describing that exact garment as real, in detail, with no `propose_outfit` call. The system had **proof** the claim was false at the moment it was generated and let it through anyway. This is not a case for Part 4's passive consistency check — it needs active interception:

- **New server-side gate, checked before a response is sent to the client:** track the most recent `search_wardrobe` call(s) in the current turn and their query strings/result counts. If a call returned 0 items for a specific named-garment query, and the assistant's subsequent message text contains that name (or a close match) presented as a real, ownable piece — **block the response and force a retry** with an explicit correction instruction ("You searched for '{query}' and found nothing — do not describe this as a piece Yuna owns. Either offer a real alternative via search_wardrobe or say plainly that she doesn't have this piece.") — the same self-correction pattern `propose_outfit`'s validation errors already use successfully.
- This is a narrow, mechanical check (string/name matching against a known-false claim, not general fact-checking) and should be cheap to implement and low-risk to false-positive, since it only fires when the model's own tool call already proved the specific claim false.

## Part 1 — Validation failures surface, don't silently fall back or drop

Once `propose_outfit` (spec 2) exists with real validation (role/slot rules), a failed validation should render as a visible diagnostic state in the chat — same spirit as the composer's broken-card treatment — rather than silently retrying, dropping the proposal, or (worse) rendering something that doesn't match what was proposed. Reuse the composer's `NEEDS REVIEW` visual treatment where it fits.

## Part 2 — Gate-exclusion visibility in chat

When `search_wardrobe` (spec 1) excludes prohibited-tier pieces from compose-intent results, log what was excluded and why — surfaced the way the composer's roster debug shows `excludedCounts`. Doesn't need to be in the user-facing chat by default (that would clutter conversation), but should be inspectable — e.g., a small "ⓘ" affordance near a proposal showing what the search behind it filtered out, mirroring the composer card's collapsed-by-default detail pattern from the card-density spec.

## Part 3 — Per-thread instrumentation

Extend `generation_runs` (or add a parallel table if freeform chat's shape doesn't fit cleanly) to log: `propose_outfit` calls per thread, validation pass/fail counts, gate-exclusion counts, whether live weather resolved or fell back. This makes freeform chat's health queryable the same way composer runs already are — "how often does validation fail," "how often does weather fall back to heuristic" become answerable questions instead of anecdotes, consistent with how `generation_runs` already serves that role for the composer.

## Part 4 — Rationale/structure consistency check (defense in depth)

Even with structured proposals, add one lightweight consistency check: if the model's conversational prose (outside the tool call) names a specific garment that doesn't appear anywhere in the same turn's `propose_outfit` pieces, flag it — this is exactly the class of bug that was caught by chance this session (prose said "floral tunic," board didn't have it). With structured output this should be rare (there's no more prose-to-structure gap to fall into), but a String-containment check between rationale text and resolved piece names is cheap insurance against a different kind of drift (e.g., the model narrating a piece it forgot to include in the tool call).

## Tests

0. ✗ Zero-result contradiction (hard block, the severe case): fixture where a `search_wardrobe` call returns 0 items for a named query and the following assistant text references that name as a real piece → response blocked, retry forced with the correction instruction. Regression-replays the exact "Turquoise Linen Button-Up Shirt" case from the 2026-07-09 log.
0b. ✗ Outfit-shaped prose with no tool call (the intermittent case): fixture assistant text matching the Title/Top/Bottom/Shoes/Accessory pattern with zero `propose_outfit` calls in that turn → flagged per Part 1's diagnostic treatment. Does not need to hard-block (unlike test 0) unless it also fails test 0's zero-result check — these are two different severities, not the same test.
1. ✗ A validation failure (spec 2's role/slot rules) renders a visible diagnostic state, not a silent drop.
2. ✗ Gate-exclusion detail is logged and inspectable per proposal.
3. `generation_runs` (or equivalent) captures freeform-chat proposal outcomes queryable the same way composer runs are.
4. Rationale/structure mismatch check: a fixture where prose names an unresolved piece flags it; a clean match doesn't false-positive.

## Out of scope

- Any change to gate logic itself (spec 1) or proposal structure (spec 2) — this spec only makes their outcomes visible.
- Composer-side observability — already correct, unchanged.
