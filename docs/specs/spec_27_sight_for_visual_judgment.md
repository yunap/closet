# Spec 27: Sight for visual judgment — the print-pairing gate, the 6b rewrite, and the sight-registry

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
**Priority:** The taste-quality spec. Closes the office print-clash class and formally replaces the norms-enumeration direction (owner ruling below). One PR.
**Files touched:** `styling-engine/outfitSetPlanner.js` (validator + workbench instructions), `styling-engine/tools.js` (propose-path check, seen-set pass-through if not already there from spec 24), `docs/freeform-rearchitecture-handoff.md`, tests.

## Owner ruling recorded (2026-07-16): norms enumeration is DEAD

Proposal to encode per-occasion styling norms as prompt bullets (office hemlines, print counts, next funeral/baby-shower/pool norms) is REJECTED — it is scorer whack-a-mole reborn in prompt form and cannot enumerate contexts users will actually style for. The architecture's thesis stands: the model's world knowledge covers occasion norms for free. The failures were never missing knowledge — they were **visual judgments made blind**. Every impressive taste moment in the live archive (crop-top coverage thread, fog-walk layering) had view_pieces first; every print disaster (office patchwork×Apple ×3, polka-dot coastal cardigan, "muted print" fabrication, the client-day mini) was composed from catalog text alone. Fix the evidence, not the doctrine. (Spec 26's parked office-norms discussion: resolved by this ruling.)

**Economics note** (why this is affordable now): a 448px thumb + label ≈ 250–300 tokens (measured across live logs). Pre-spec-16, mid-turn images were re-billed at full price by every later call (~54 thumbs ≈ ~90k extra tokens/turn — 6b's original justification). Post-caching they write once and re-read at ~10%, so targeted sight costs ~500–1,200 tokens per print-mixing outfit. The 6b default (don't browse 150 pieces) stays sane; its blanket "don't look" is stale.

## Part 1 — Print-pairing sight gate (hard, evidence-backed)

In `validateSubmittedPlanOutfits` (using the seen-set spec 24 Part 3 already passes in) and in `propose_outfit`'s contract-issue block (parallel to the existing layer-sight rule):

- **Trigger:** an outfit whose MAIN pieces (dress/top/bottom/outerwear — accessories excluded for now, see registry) include **2+ pieces with a known non-solid `pattern_type`**.
- **Requirement:** every one of those printed pieces must be in this turn's `visuallySeenPieceIds`.
- **Rejection (coached):** `"this outfit pairs N printed pieces — print mixing is a visual decision: call view_pieces on [ids], look at how the prints actually interact, then resubmit (keep the pairing only if it genuinely works to the eye)."`
- Unknown/missing `pattern_type` does NOT trigger (tags are the truth surface; don't punish untagged pieces — record as a registry item if blind clashes slip through that hole).
- Solids-only and single-print outfits are untouched. The spec-24 layering gate stays independent.

Tests: blind two-print plan submission rejected with the coaching + ids; identical submission after `view_pieces` accepted; one print + solids passes unseen; unknown pattern_type + one known print passes; propose-path parity (blind two-print `propose_outfit` rejected, seen accepted); accessories (printed scarf + printed top) do NOT trigger (registry candidate, not gate).

## Part 2 — Rewrite the 6b instruction: license judgment-driven sight

Replace the workbench's "Do not call view_pieces for roster pieces; make at most one small view_pieces call only if genuinely needed" with:

> "Viewing pieces is cheap. VIEW the pieces of any outfit whose visual coherence you are uncertain about — print combinations, statement pieces, layering, anything sheer or revealing, silhouette pairings you haven't seen work. Compose directly from the catalog when pieces are solids and the combination is conventional. Do not bulk-browse the whole roster."

Same judgment-to-the-model principle as the rest of the architecture: we license WHEN to look instead of enumerating cases. Watch metric: `viewCalls` per plan turn in the diagnostics — expected to settle at 1–3 small calls on print-heavy plans, 0 on solid-basics plans; a drift back toward always-browsing-everything is the regression signal (the gate in Part 1 still holds the floor if the model under-looks).

## Part 3 — The sight-registry (recorded, no code)

Candidate future hard gates, promoted ONLY when live evidence shows Part 2's soft policy missing them — the same evidence path by which layering (spec 24) and prints (Part 1) earned theirs:

1. **Sheer-as-coverage**: a piece with low/sheer `opacity` used in a coverage-bearing role → require sight. (The model handled this correctly WITH sight in the crop-top thread.)
2. **High-`bareness` piece in a professional-context slot** → require sight (the client-day mini class; both `bareness` and `coverage` fields already exist in style_profile_json).
3. **Printed accessories** (scarves/wraps) counting toward the print-pairing trigger.
4. **Silhouette bulk pairings** (voluminous over voluminous — the blouse-over-midi veto) — hardest to trigger from tags; likely stays judgment.
5. **Unknown `pattern_type` pieces in multi-statement outfits** (the tag-hole in Part 1's trigger).

## Acceptance (live, owner-run)

- Office week re-run: Wednesday-class print stacking either doesn't happen, or happens WITH the pieces viewed and survives your eye — both outcomes are wins; a blind print clash is the failure.
- Any print-mixing turn's log shows view_pieces on the printed ids before the accepting submit.
- A solid-basics plan (e.g. the office week's Monday/Tuesday shape) still composes with zero view calls — the default didn't regress to browsing.
- `viewCalls` stays ≤ ~3 per plan turn across a few normal turns.

## Risks

Part 1 is evidence-demanding, not taste-encoding — the model may still keep a pairing after looking, and that's legitimate (then it's taste, handled by reactions/rules). Part 2's risk is view-call inflation, watched via diagnostics with the old instruction one revert away. The known trade: turns get slightly slower/costlier when prints are involved — by design, and by roughly the cost of one sentence of prose.
