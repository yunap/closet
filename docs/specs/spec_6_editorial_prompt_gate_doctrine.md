# Spec 6: Occasion/weather/activity doctrine missing from the editorial ideation prompts

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


**Status:** Implemented (2026-07-09). Full suite 348/348 green.

## Implementation notes (2026-07-09)

- Both parts added exactly as specced above — 3 new bullets in `EDITORIAL_NEW_PIECES_SYSTEM`, the single weather bullet in `OUTFIT_EVALUATOR_GATE_SYSTEM` extended into three.
- **Caught and fixed a syntax bug immediately via the test run:** the first draft of Part 2's register bullet used markdown-style backticks around the word `rejected` (`` `rejected` ``) inside the prompt's JS template literal — since these prompts are plain backtick-delimited template strings, the nested backtick prematurely closed the string and threw a `SyntaxError` at module load. Fixed by rewording to "the rejected list" (no backticks). Worth remembering for any future edits to these prompt constants: no literal backticks inside the string content.
- Tests: `test/editorialPromptGateDoctrine.test.js` (2) — confirms the new doctrine lines exist in both prompts, and regression-guards the original weather-adaptation line so Part 2's extension didn't accidentally reword or drop it.
- No test asserted these prompts' content previously (confirmed before implementing), so no existing assertions needed updating.

**Original status:** Ready for implementation. Confirmed live and reachable from the UI (2026-07-09) — not a dead-code question for this spec specifically (see the note at the end on the broader cleanup this surfaced).
**Priority:** Medium — these flows explicitly invent conceptual pieces, not real inventory, so there's no owned garment to mechanically gate; the fix is prompt doctrine, not code, and lower-risk/lower-urgency than spec 5's mechanical gap.
**Files touched:** `styling-engine/prompts.js` (`EDITORIAL_NEW_PIECES_SYSTEM`, `OUTFIT_EVALUATOR_GATE_SYSTEM`), tests.

---

## Finding

Traced two UI actions on the piece-anchored ("selected item") builder in `StylistChat.jsx`:

- **"Use my wardrobe"** → `composeSelectedPieceVisualWardrobeOutfits` → `buildVisualComposerRoster` directly ([routes/ai.js:1582](../routes/ai.js:1582)). **Fully gated** — same register-ceiling/footwear/weather mechanism as everywhere else. Not in scope for this spec.
- **"Explore additions"** (`editorialVisualMode: true` in the `send()` call, [StylistChat.jsx:4868](../src/components/StylistChat.jsx:4868)) → routes to `POST /editorial-directions-preview` ([routes/ai.js:3211](../routes/ai.js:3211)) → `EDITORIAL_NEW_PIECES_SYSTEM` ([prompts.js:941-998](../styling-engine/prompts.js:941)). This is intentionally pure ideation — it invents conceptual missing pieces ("cognac slim-soled pointed loafer") rather than selecting real inventory, so there is no real piece object for `profileRuleFit` to check formality/heel_height against. A mechanical gate genuinely cannot apply here.

A third, related path shares one of the same prompts: the `includeMissingPieces`/`idealOnly` toggle on `/generate-outfits-for-piece` (blends real ranked pieces with missing-piece placeholders) calls `composeStructuredOutfitsForPiece` ([core.js:1017](../styling-engine/core.js:1017)), which uses `OUTFIT_COMPOSER_SYSTEM` to generate and `OUTFIT_EVALUATOR_GATE_SYSTEM` ([prompts.js:437-471](../styling-engine/prompts.js:437)) as a second-opinion evaluator pass.

**Read both prompts in full.** Neither has any occasion-register, footwear-comfort/activity, or (for the evaluator) more than one passing weather line:
- `EDITORIAL_NEW_PIECES_SYSTEM`: entirely silhouette/texture/color/anti-drift doctrine (no beige cardigan, no scarves, grounding formulas). Zero mention of formality, register ceiling, weather adaptation, or activity/footwear comfort — despite `occasion`/`season`/`mood` being passed into the user-content block every call ([routes/ai.js:3255-3258](../routes/ai.js:3255)). The model receives the context but is never told what to *do* with it.
- `OUTFIT_EVALUATOR_GATE_SYSTEM`: has exactly one relevant line — "adapt checks to the requested occasion, season, and mood (e.g. ... hot weather ...)" ([prompts.js:450](../styling-engine/prompts.js:450)). Nothing on register ceiling ("don't pass a dressy suggestion for an elevated-ceiling occasion") or footwear/activity comfort ("don't pass heels for a hiking-anchored request").

This is the same class of soft-guidance risk `STYLIST_SYSTEM` had before spec 1 — except here it can't be made mechanical, because these flows don't operate on real tagged pieces. The only lever is prompt doctrine, mirrored from what `STYLIST_SYSTEM` already says explicitly.

## Part 1 — `EDITORIAL_NEW_PIECES_SYSTEM`: add occasion/weather/activity doctrine

Insert alongside the existing "Rules:" block ([prompts.js:957](../styling-engine/prompts.js:957)), mirroring `STYLIST_SYSTEM`'s existing language so the two prompts don't drift into different doctrine for the same concepts:
```
- Respect the stated occasion's register: do not suggest a dressier archetype than the occasion calls for (e.g. no cocktail-weight pieces for a gallery/museum/daytime-casual occasion; no going-out pieces for a home/errand occasion).
- Adapt to the stated season/weather: do not suggest heavy insulating fabrics (wool, heavy knits, structured outerwear) for a hot/summer occasion, or lightweight/bare pieces for cold weather.
- If the request implies physical activity (walking-heavy, hiking, travel by foot), suggested shoe archetypes must be walkable: prefer flats, loafers, sneakers, structured boots, or low block heels; do not suggest stilettos, delicate sandals, or high heels.
```

## Part 2 — `OUTFIT_EVALUATOR_GATE_SYSTEM`: extend the existing occasion-adaptation check

The evaluator already has the right idea for weather (line 450) but stops short of register/activity. Extend that single bullet into three, right where it lives in the "Keep only outfits that pass these checks" list:
```
- adapt checks to the requested occasion, season, and mood (e.g. if the user describes hot weather or summer, do not reject lightweight shorts/sandals/skirts outfits as "too casual" or "lacking structure" if they make styling sense for the heat).
- reject (or flag in `rejected`) any outfit whose formality clearly exceeds the stated occasion's register (e.g. a cocktail/dressy piece proposed for a gallery, museum, or daytime-casual occasion).
- reject (or flag) any outfit with stilettos, delicate sandals, or high heels when the request implies a walking-heavy or hiking activity.
```

## Tests

Prompt-string assertions, following this repo's established convention for verifying system-prompt content (see `test/stylingIntent.test.js`):
1. `EDITORIAL_NEW_PIECES_SYSTEM` includes the register/weather/activity lines added in Part 1.
2. `OUTFIT_EVALUATOR_GATE_SYSTEM` includes the two new register/activity check lines added in Part 2.
3. Existing weather-adaptation line (line 450) is unchanged (regression guard — don't accidentally reword/lose it while extending).

**Caveat, stated plainly:** unlike specs 1/5, this is prompt doctrine, not mechanical code — `npm test` can only verify the strings are present in the prompt, not that the model actually follows them. Real verification is a live test: ask for "Explore additions" on a gallery/museum-anchored piece and confirm no dressy suggestion appears; ask for it on a hiking-anchored piece and confirm no heels.

## Out of scope

- Any mechanical gate — not possible here since there's no real piece to check (see Finding).
- `OUTFIT_COMPOSER_SYSTEM` itself (the generation-side prompt, as opposed to the evaluator) — the evaluator is the actual gate; extending it should be sufficient without also touching the generator, consistent with how `OUTFIT_EVALUATOR_GATE_SYSTEM` already exists specifically to catch what the composer produces.
- Spec 5 (trip-precompose register-ceiling gap) — mechanical, separate, unaffected by this.

---

## Note: this surfaced a broader question — is all of this still wired to the UI?

Auditing these flows required tracing through roughly a dozen distinct backend endpoints and outfit-composition subsystems (`search_wardrobe`/`propose_outfit`, `buildVisualComposerRoster` [x2 call sites], `buildLocalTripSlotOutfits`, `rankSelectedPieceCandidatesWithVision`+`composeStructuredOutfitsForPiece`, `EDITORIAL_NEW_PIECES_SYSTEM`, the tier-3 `OUTFIT_BOARD_PLANNER_SYSTEM` fallback in `/generate-outfit-boards`, plus several more editorial/evaluation endpoints not yet fully traced: `/editorial-render-one`, `/generate-ideal-additions-preview-sheet`, `/generate-wardrobe-outfit-comparison-sheet`). At least one route (`/generate-wardrobe-outfits`) is already explicitly marked `deprecated: true` in its own response and appears to be a kept-alive alias of `/generate-wardrobe-outfits-visual`.

Before investing further gate/prompt work into any of these, it's worth a dedicated pass to confirm which endpoints are still reachable from the current UI versus orphaned from earlier iterations of the app — both to avoid fixing something nobody can trigger anymore, and because dead code is itself a maintenance and audit-confidence cost (every future "is this the last such flow" question has to re-walk paths that may not need walking at all). This is a distinct effort from spec 6 — scoped separately, not blocking it, since both `EDITORIAL_NEW_PIECES_SYSTEM`'s and `OUTFIT_EVALUATOR_GATE_SYSTEM`'s call sites were confirmed live and UI-reachable above.
