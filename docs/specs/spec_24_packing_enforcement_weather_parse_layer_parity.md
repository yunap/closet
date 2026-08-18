# Spec 24: Enforced footwear packing under maximize, stated-weather parse precedence, plan-mode layering sight parity, and two persistence fixes

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
**Priority:** Part 1 carries an owner ruling (2026-07-16: option (c) — enforce packing as a constraint). Part 2 is a twice-recurred gate misfire that trains anchor-abuse. Part 3 closes a founding-incident parity hole. Parts 4–5 are strings against confirmed behavior clusters. One PR.
**Files touched:** `styling-engine/outfitSetPlanner.js` (`validateSubmittedPlanOutfits` — shoe ledger + layering sight check; workbench instructions), `styling-engine/tools.js` (pass the seen-pieces set into validation; submit success message), `styling-engine/weather.js` (stated-text parse precedence), tests.

## Live evidence (2026-07-16, wardrobe-dev.log.claude12 + claude11)

- **Packing (Part 1):** unbudgeted Paso re-run with `reuse:"maximize"`, `allow_repeat:["shoes"]`, AND spec 23's numeric instruction ("at most 2 pairs of shoes"): **7 outfits, 7 distinct pairs of footwear**, 27 distinct pieces. Instruction generations 1 (spec 18) and 2 (spec 23) both ignored; measurement trend 16/18/20/18/27. The string approach is exhausted. Owner ruled: enforce.
- **Weather parse (Part 2, second occurrence):** Point Reyes fog-walk ask — the model stated `season: "cool coastal summer"` with context "foggy, windy… 55–58°F, marine layer," and the HOT-weather insulating gate rejected the denim and leather jacket ("hot weather: insulating piece") because the word "summer" out-parses every cool qualifier. Same class as the 07-15 "summer rain, cool mountain" incident. The model recovered by `anchor:true` on three pieces the user never named — wrong gates re-teaching the escape hatch, the exact dynamic spec 18 Part 1 was written to stop.
- **Layering sight parity (Part 3):** the office-week run's Wednesday card layered the abstract animal print blouse OVER the black abstract midi dress — composed **blind** (zero view_pieces that turn) and owner-rejected on sight. `propose_outfit` has required layer pieces to be SEEN since the crochet founding incident; `submit_plan_outfits` has no such check, so plan cards can layer blind. Model-initiated top-over-dress in plan mode is now 4 occurrences with 1 good outcome (the crop-top thread — where the model HAD viewed the pieces).
- **Double layer (Part 4, third occurrence):** cardigan + shawl on the same outfit (Paso Dinner 2; previously Paso 07-16 dinner, claude10 dinner).
- **Post-success rebuild (Part 5):** the model attempted `propose_outfit` re-renders of already-accepted plan cards again in both claude12 turns — persistent across ≥5 runs, blocked every time, 2–5 wasted iterations each.

## Part 1 — Enforce distinct-footwear packing under reuse:maximize (owner ruling: option c)

**Why constraint-side, not taste:** `reuse:"maximize"` is a user packing directive with enforcement precedent — `piece_budget` is already hard-enforced through the same ledger. Under-reuse is not an aesthetic judgment; it is the directive not being followed.

Mechanics, in `validateSubmittedPlanOutfits`, active ONLY when `constraints.reuse === 'maximize'`:

- Track distinct shoe ids across held + accepted outfits (the ledger already walks category pairs).
- When a submission's shoe is NOT already in the used-shoe set and the distinct count is already ≥ 2: **reject only if some already-used shoe is gate-eligible for this slot** (`slot.gateAllowedIds.has(usedShoeId)`). Coached message: `"this would be a 3rd pair of shoes under reuse:maximize — reuse one of: <names of gate-eligible used shoes> (they pass this slot's gates), or drop reuse:maximize if packing light isn't the goal."`
- If NO already-used shoe is gate-eligible for the slot, the new pair is allowed — the activity exemption (hiking's athletic shoe, a dressy slot's heels) falls out naturally from gate eligibility, with zero activity-specific code.
- The cap never blocks the FIRST or SECOND distinct pair. Modes `diversify`/`none`/unset: untouched.
- Report already discloses the repeat schedule; no new lines needed.

Tests: the live Paso shape (7 slots, maximize) — 3rd+ distinct shoe rejected with the coached message naming reusable pairs; hiking slot still gets its athletic pair when the 2 used pairs fail its gates (exemption); `reuse:"diversify"` byte-identical; first two pairs never blocked; the used-shoe set survives a spec-23 partial re-plan merge.

## Part 2 — Stated cool qualifiers beat season words in weather-text parsing

In the stated-text parse path (`weatherProfileFromContext` and whatever feeds `resolveStatedOrLiveWeather`'s stated branch — NOT live-forecast profiles):

- Cool signals: cool, cold, chilly, fog(gy), marine layer, windy, breezy, overcast, drizzle, rain(y).
- **Season words alone (summer, July…) lose to cool signals; explicit heat words (hot, heat, 80s/90s, scorching) keep winning.** The asymmetry is the point — pin it with exactly these three fixtures:
  - `"cool coastal summer"` → NOT hot (the Point Reyes miss).
  - `"summer rain, cool mountain"` → NOT hot, rainy (the 07-15 miss).
  - `"hot days, cool evenings"` → STILL hot (explicit "hot"; the Paso plan-level string — must not regress daytime slots).
- Rain words set the rainy profile where the profile supports it.

Effect: the insulating-piece gate stops rejecting jackets on fog walks, which removes the incentive for unprompted `anchor:true` — after this, anchor-after-rejection on user-unnamed pieces becomes a clean signal worth counting (`anchorBypassAfterReject` diagnostic, optional, 3 lines).

## Part 3 — Plan-mode layering requires sight (parity with propose_outfit)

In `validateSubmittedPlanOutfits`: an outfit containing BOTH a dress and a top requires both pieces to be in this turn's visually-seen set (`toolContext.visuallySeenPieceIds`, passed into validation). Rejection: `"this outfit layers a top over a dress — call view_pieces on [ids] first, then resubmit; layering is a sight-required decision."`

This is the founding-incident rule (layer pieces must be SEEN) applied to the one composition path that escaped it — spec-1 lineage, evidence-not-judgment. It does NOT ban top-over-dress: the crop-top thread's version (viewed large, deliberate) passes untouched. Tests: blind top+dress submission rejected with the view_pieces coaching; same submission after view_pieces accepted; top+bottom outfits unaffected; the propose_outfit path unchanged.

## Part 4 — One-layer instruction

Workbench instructions line: `"At most one layer (cardigan, jacket, or shawl) per outfit unless cold or rain genuinely demands two."` Third confirmed occurrence of cardigan+shawl stacking earns the line; it stays a string (layer-count is judgment — a ski plan legitimately doubles).

## Part 5 — Submit-success anti-rebuild line

Append to `submit_plan_outfits`' success message: `"These cards are already displayed to the user — do NOT call propose_outfit or render them again; write your final answer presenting them."` Persistent across ≥5 runs; message-first per doctrine (the hard gate already backstops it — this just stops the wasted iterations).

## Recorded, no code

- Office silhouette taste cluster (maxi skirt + shawl reading as evening at a client presentation): owner is trying the designed lever first — an in-app stored rule via `store_user_correction` ("office/client days: structured silhouettes, no maxi skirts or shawls"). If stored rules don't hold, a STYLIST_SYSTEM office bullet is the escalation — revisit only with that evidence.
- Anchor-abuse counting: if unprompted anchor-after-rejection persists AFTER Part 2 removes the wrong-gate incentive, add the diagnostic counter before any mechanism.

## Risks

Part 1 is the only mechanism and it is scoped to one mode + one category with a natural exemption; the merge-interaction test guards the sharpest edge. Part 2 changes stated-text parsing only, with the "hot days, cool evenings" regression fixture pinning the asymmetry. Part 3 adds a check that a compliant model satisfies with one thumbnail call. Parts 4–5 are strings.
