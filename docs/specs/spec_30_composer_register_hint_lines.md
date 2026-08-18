# Spec 30: Register-hint lines in the visual composer prompts (the athletic-pants fix)

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


**Status:** Proposed (2026-07-18). Not implemented. Owner requested after the 2026-07-18 smoke diagnosis.
**Priority:** Small, single-concern. One PR.
**Files touched:** `routes/ai.js` (two prompt-line sites + one tiny helper), one test file, docs note.

## Evidence / incident

2026-07-18 smoke (post spec 21/29): the whole-wardrobe Visual Composer city run produced "Vibrant Floral + Dark Denim Column" — piece 990359 "black drawstring pocketed pants" paired as a structured dark trouser under an elevated floral top, with "denim" hallucinated in the title. Diagnosis (verified in code, memory: `visual-composer-athletic-pants-incident`):

- **Not a spec 21/29 regression.** Spec 21 touches nothing in this path; spec 29 Part 1's rehydrated gates cap dressiness / check footwear & materials — "too sporty for the occasion" has never been a gate, deliberately (gate-history doctrine: below-ceiling composition is LLM judgment).
- **Tag truth is fine.** 990359 is legitimately roster-eligible for city (`formality: everyday`, city confidence `medium`, trusted). The register information already exists in its tags: `reads_as: "sporty casual pants"`, `fabric_category: technical/performance`.
- **The composer never sees it.** Both composer per-piece prompt lines are name-only: `ID {id}: {name}` at `routes/ai.js:1573` (whole-wardrobe, `generateWholeWardrobeOutfitsVisualInternal`) and `routes/ai.js:674` (selected-piece, `composeSelectedPieceVisualWardrobeOutfits`). The model composed from name + photo alone.

## Part 1 — Append fabric/reads_as hints to both composer per-piece lines

Add a small helper in `routes/ai.js` (near the two call sites, module-local):

```js
const composerPieceLineSuffix = piece =>
  `${piece.fabric_category ? `; fabric: ${piece.fabric_category}` : ''}${piece.reads_as ? `; reads_as: ${piece.reads_as}` : ''}`
```

and use it at both sites:

- `routes/ai.js:1573` → `` `ID ${p.id}: ${p.name}${composerPieceLineSuffix(p)}` ``
- `routes/ai.js:674` → `` `${labelPrefix} ID ${piece.id}: ${piece.name}${composerPieceLineSuffix(piece)}` ``

**Precedent:** this is byte-for-byte the format the tagger calibration anchors already use (`routes/ai.js:352`: `; fabric: …; reads_as: …`). Field order and separators match it exactly — no new prompt vocabulary.

**Visual-grounding compliance (founding principle):** additive text alongside the photos, which are untouched. This is the sanctioned direction — enrich the text next to the image, never replace the image with text.

**Explicitly NOT a gate.** No roster change, no suppression change, no new rejection reason. The model keeps full judgment; it just finally sees the register facts the tagger already recorded. Missing/empty fields degrade to today's exact line.

## Part 2 — Test

Route-level, using the existing `aiEndpointContracts.test.js` harness (mocked `askStylistWithUsage` + recorded `aiCalls`; fixtures already carry `reads_as`): drive one whole-wardrobe visual composer request, find the captured per-piece text lines, assert a fixture piece's line contains its `reads_as` value (and `fabric:` when the fixture has one), and that a fixture with neither field renders the unchanged `ID {id}: {name}` line. If wiring that route through the harness turns out to be disproportionate, fall back to the repo's established source-contract pattern: assert both call sites reference `composerPieceLineSuffix`.

## Acceptance

- `npm test` fully green (including the spec-29 regression test and the wardrobe.db-mtime hermeticity guarantee — this PR must not disturb either).
- Live smoke, both paths: (a) one whole-wardrobe city run — check whether 990359-class pieces still get narrated as trousers/denim under elevated tops (observational: model judgment, not a hard assert; the win condition is the card narration acknowledging the sporty register or the pairing avoiding it); (b) one "Style this piece" run to confirm the selected-piece path renders normally with the longer lines.
- Prompt-size sanity: ~90 roster pieces × a few tokens each ≈ well under 1k extra input tokens per composer call — note the observed composer token delta from the smoke logs in the PR description.

## Risks / out of scope

- The only behavior change is prompt text; parsing/resolution is untouched (model output is matched by id/name, never by prompt-line format; no test pins the current line format — verified by grep).
- Out of scope, deliberately: any "too sporty" gate (gate-history doctrine), re-tagging 990359 (`formality: everyday` is correct; the register lived in `reads_as` all along), `support_only` plumbing into the advisor path (its −18 penalty in the local-candidate scorer stays as-is), and the fuller `buildWardrobePieceTruthText` blob (too heavy per-piece at roster scale — fabric + reads_as only, matching the anchor precedent).
