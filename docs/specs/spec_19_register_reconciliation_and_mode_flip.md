# Spec 19: Register floor/ceiling reconciliation, unfillable-floor escape hatch, piece_ids truthfulness — and the model-mode default flip

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
**Priority:** Parts 1–2 are the last known validator-boundary issues from the spec-13 scenario runs (both cost multi-resubmit loops or a 0-filled slot); Part 3 is a one-line truthfulness instruction; Part 4 is the spec-13 flip itself, now that the scenario table is complete. Ship as one PR. Spec 14 (the scorer-layer deletion) is unblocked once this merges — no soak period; its own hardRejects audit is the gate.
**Files touched:** `styling-engine/outfitSetPlanner.js` (`normalizePlanSlots` / `effectiveSlotRegisterCeilingRank`, `validateSubmittedPlanOutfits` messages, workbench instructions), `styling-engine/tools.js` (mode default at the `planComposeMode` read, ~line 1496), `.env` (delete the now-redundant `WARDROBE_PLAN_COMPOSE=model` line), `docs/freeform-rearchitecture-handoff.md`, tests.

## Live evidence (Anthropic model-mode scenario runs, 2026-07-15 evening)

**Office-week run** ("five-day office week — no repeating tops, shoes can repeat. On Thursday I'm presenting to a client."):

- The model declared Thursday `register: "dressy"` on its own judgment ("dressiest day of the week"). The wardrobe has no dressy-tagged office-appropriate pieces, so the floor was unfillable — and the model **blind-resubmitted three times** (paisley blouse + Apple skirt → floral top + wide-leg trousers → wool knit dress + jacket), every attempt made of `elevated` pieces whose formality tags it had in the catalog. Rejections were truthful ("X is below the dressy register floor") but offered no way out; the legal escape — re-call `plan_outfit_set` with that slot at a lower register — is never mentioned. Result: resubmit cap, Thursday delivered 0/1 with a gap line. The gap line is honest, but the slot was *fillable at `elevated`* — the model's own over-escalation locked it out.
- Separately: the Tuesday card's submitted reason literally contains "**Actually revising:** emerald v-neck top + oatmeal textured elastic waist pants…" while the submitted `piece_ids` still carried the abstract midi dress the prose had just rejected — the model revised its prose but not its ID array. Structure allowed it (top-over-dress is legitimate layering), so the card renders an outfit its own reason argues against. (Part 3.)

**Wedding-weekend run** ("dressy rehearsal dinner Friday, formal outdoor ceremony Saturday, casual farewell brunch Sunday"):

- The model declared the brunch slot `occasion: "casual"` **plus** `register: "elevated"` — a floor above the occasion's everyday ceiling. Pieces were then rejected with "register: elevated exceeds everyday ceiling" — truthful against the ceiling, but incoherent from the model's perspective (it *asked* for elevated). Two resubmits before it stumbled into all-everyday pieces. The slot spec was self-contradictory and nothing reconciled or flagged it.
- Everything else in both runs worked: register floors caught real misses (botanical maxi below the formal ceremony floor), live forecast resolved for a never-seen location (Catskills), the model asked one genuinely useful venue question unprompted, and final quality was good (4/5 and 3/3).

## Part 1 — Unfillable register floor: detect it and name the way out

Two changes to the register-floor rejection path in `validateSubmittedPlanOutfits`:

1. **Escape hatch in the message, always.** Append to every register-floor rejection: `"If this slot's register should be lower, re-call plan_outfit_set with just this slot at a lower register (or omit register) — resubmitting different pieces cannot change the floor."` The model had no legal move inside `submit_plan_outfits` and nothing told it so; this is the same message-coaching pattern as spec 15 Part 2.
2. **Deterministic unfillability detection.** When a floor rejection fires, count the slot's `gateAllowedIds` pieces that clear the floor, per category group (top/bottom/dress/shoes). If no structurally viable main path clears it (no floor-clearing dress AND no floor-clearing top+bottom pair, or no floor-clearing shoes when shoes are required), say the stronger truth: `"no combination in this slot's roster can meet the <rank> floor — lower the register via a fresh plan_outfit_set call for this slot, or accept the disclosed gap."` This is arithmetic over tags already held on the pending plan — no new gating, no combinatorics beyond category counts.

Do NOT auto-lower the floor server-side: the model's declared register is a real judgment (the ceremony floor doing its job in the same run proves its value); the fix is making the *stuck state* legible, not second-guessing the declaration.

## Part 2 — Reconcile a declared register above the occasion ceiling

In slot normalization (`normalizePlanSlots` / wherever `effectiveSlotRegisterCeilingRank` derives the ceiling): when the slot's declared `register` maps to a formality rank **above** the occasion's register ceiling, raise the effective ceiling to the declared register's rank. Rationale: `occasion:"casual", register:"elevated"` means "casual event, dressed up a notch" — the declaration is an explicit escalation (the exact mechanism `slot.register` was built for in the wedding-ceremony arc) and must win over the occasion default, or the slot is self-contradictory: a floor the ceiling forbids.

- Floor derivation is untouched — only the ceiling lifts to at least the floor. Invariant to pin with a test: **effective ceiling ≥ effective floor for every normalized slot.**
- Slots without a declared register keep today's occasion ceilings exactly (engine mode unaffected; no general loosening).
- The workbench already prints `register_ceiling`/`register_floor` per slot, so the reconciled values are visible to the model — no extra surface needed.

## Part 3 — "The piece_ids ARE the outfit" instruction

Append one line to the workbench `instructions` in `buildPlanSlotWorkbench`: `"The piece_ids ARE the outfit. If you change your mind while writing the reason, update piece_ids to match — never submit a reason describing pieces you did not include."` Same family as spec 18 Part 5 (instruction against an observed fabrication shape, zero mechanism — prose-vs-IDs consistency is not mechanically checkable without the keyword-matching this codebase has repeatedly ruled out). Live evidence is the Tuesday "Actually revising:" card above.

## Part 4 — Flip WARDROBE_PLAN_COMPOSE default to 'model'

The spec-13 flip criterion is met: all six scenario families ran live in model mode (trip+microclimate, budgeted capsule ×4, beach, work week with `no_repeat:['tops']`, event weekend with register escalation, anchor via the propose path), resubmits converged (post-#104 capsule: one submit, zero failures), no validator-missed correctness class remains open, and the owner judged quality ≥ engine mode.

- At the `planComposeMode` read in `tools.js` (currently `String(process.env.WARDROBE_PLAN_COMPOSE || 'engine')`): default `'model'`. Engine mode stays fully runnable via `WARDROBE_PLAN_COMPOSE=engine` — same reversible-flag convention as the pre-routes. Do not delete any engine code in this PR; that is spec 14's job, on its own audit.
- Delete the now-redundant `WARDROBE_PLAN_COMPOSE=model` line from the repo-local `.env` (it was the source of the Step-0 test leak; the suite is hermetic now, but the override would mask the real default in dev).
- Tests that exercise engine mode set the env var explicitly (most already do, from the Step-0 hermeticity work); tests that relied on the implicit engine default get the explicit var. Model-mode tests may drop their now-redundant env setup or keep it for clarity — keep the suite green either way.
- Update the handoff doc: spec 13 flip DONE with this evidence; spec 14 unblocked (owner ruling 2026-07-15: no soak period — sequential PRs, git history is the fallback, spec 14's hardRejects audit is the gate).

## Recorded watch items (no code in this spec)

- **Post-success propose_outfit rebuild urge**: in both scenario runs the model tried to re-render already-accepted cards via `propose_outfit` after the plan closed; the hard gate blocked it every time (as designed), at a cost of 2–5 iterations per turn. If it persists after this PR's messages land, the escalation is a line in the `submit_plan_outfits` success message, not a new gate.
- **Mixed stated weather** ("summer rain, cool mountain" parses hot → insulating gate rejected cardigans on a rain follow-up; one occurrence, model recovered with a better layer).
- **Per-slot 3-look cap** still trims `count: 4 → 3` without a `[plan trimmed:]` disclosure — owner ruling still pending on whether that cap should disclose like the total cap does.

## Tests

- Part 1: register-floor rejection includes the re-call escape hatch; a fixture wardrobe with zero dressy office pieces triggers the "no combination can meet the floor" wording; a fixture where one dressy path exists does NOT trigger it (plain floor rejection + hatch only).
- Part 2: `occasion:'casual'` + `register:'elevated'` slot yields effective ceiling ≥ elevated (the brunch repro: an elevated top is accepted); undeclared-register slots keep today's ceilings byte-identically; ceiling ≥ floor invariant across a matrix of occasion × register declarations.
- Part 3: instruction string present in every workbench response.
- Part 4: default mode is model with no env var set; `WARDROBE_PLAN_COMPOSE=engine` restores engine composition (assert a composed `success` response, not `slot_rosters`); suite green with no `.env` dependence.

## Risks

Low. Part 1 is message-only plus tag arithmetic. Part 2 widens a ceiling only when the model explicitly declared a higher register — the contradiction case; everything undeclared is untouched. Part 3 is a string. Part 4 changes a default the owner's `.env` has already made her lived reality for days, with the engine path kept flag-restorable until spec 14 retires it on its own evidence.
