# Spec 2/3: Structured outfit proposals (eliminate prose-then-parse)

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


**Status:** Design review complete (2026-07-08) — building. Decisions below.

## Design-review outcomes (2026-07-08) — these govern the build

Investigation found the architecture already does most of what this spec proposed to build: `render_outfit` ([tools.js:396](../styling-engine/tools.js:396)) already appends a **structured outfit with `pieceIds`** to `toolContext.generatedOutfits`, which `/ask` returns as `structuredOutfits` ([routes/ai.js:3684](../routes/ai.js:3684)), which the client **already renders as cards** ([StylistChat.jsx:1363](../src/components/StylistChat.jsx:1363), with `isMultiOutfitResponse` checking the structured array first at [:1136](../src/components/StylistChat.jsx:1136)). The prose parser is a **fallback**, not the primary path. So `propose_outfit` is an evolution of `render_outfit`, not a greenfield tool. Decisions:

1. **Replace `render_outfit` with `propose_outfit`.** New tool takes piece **IDs** (not names — `render_outfit`'s `resolveActivePieceByName` is a fragile name-matching seam the model doesn't need, since it already has IDs from `search_wardrobe`), plus **roles**, **validation**, and **`missing_gaps`**. Route through the same `toolContext.generatedOutfits` → `structuredOutfits` → client-card channel that already exists. Remove `render_outfit`.
2. **Roles only, no `layerOf`** (this pass). Role enum: `primary_top | layer_top | primary_bottom | layer_bottom | dress | shoes | outerwear | accessory`. Validity derives from roles alone (two `primary_top` = slot collision/invalid; `primary_top` + `layer_top` = valid layering). Add `layerOf` later only if real usage needs it.
3. **Keep the prose parser for old threads** — do NOT delete `structuredOutfitsFromGeneratedText` / `getEditorialNotes` this pass. New turns produce structured proposals via `propose_outfit`; the prose fallback stays so already-persisted prose-only threads still render. Deletion deferred (spec 2 Part 4 becomes a later cleanup once old threads age out). This shrinks the build to: add `propose_outfit`, remove `render_outfit`, update the prompt, make the client render roles + gaps.

---

**Status (original):** Ready for design review before implementation — this is the largest architectural change in the sequence and touches the model-facing contract directly.
**Priority:** High, but sequence-dependent on spec 1 landing first (gate parity should be true regardless of output format before the format itself changes)
**Files touched:** `prompts.js` (`STYLIST_SYSTEM`, new tool schema), `tools.js` (new `propose_outfit` tool handler), `routes/ai.js` (`/generate-outfit-boards` — route structured proposals through the existing structured path), `StylistChat.jsx` (client-side prose-detection seam: `isMultiOutfitResponse`/`getEditorialNotes`), `core.js` (retire `structuredOutfitsFromGeneratedText` + helpers once the `conceptsText` fallback branch is dead), tests
**Design correction incorporated (Yuna, 2026-07-08):** "two tops" is a legitimate layering choice (base layer under a sheer/open piece), and "two bottoms" is rarer but real (shorts over leggings, slip under a skirt). The schema must represent *intentional layering* as a distinct, valid shape — not treat any second top/bottom as malformed. This replaces the earlier blanket "never two bottoms" language from prior specs with a role-based model.

## Scope corrections (verified against code, 2026-07-08)

The original draft mislocated the prose→structure seam. What the code actually shows:

1. **The seam is in the board-generation endpoint, not `StylistChat`'s message render.** `structuredOutfitsFromGeneratedText` is server-side, called only at [routes/ai.js:2870](../routes/ai.js:2870) inside `POST /generate-outfit-boards`, as the **middle fallback**: `boardPlanFromStructuredOutfits(structuredOutfits)` → *then* `structuredOutfitsFromGeneratedText(conceptsText)` → *then* an LLM re-planner. `StylistChat` reaches it by passing the chat message's prose (`m.text`) into `generateVisualBoards(...)`.
2. **A structured path already exists — this is less greenfield than written.** [`boardPlanFromStructuredOutfits`](../styling-engine/core.js:1741) already accepts `{ pieceIds }` or `{ pieces: [{id}] }` + `missingPieces` and produces board plans. `propose_outfit`'s output maps almost directly onto it. Part 3 is therefore mostly "route `propose_outfit` into the existing `structuredOutfits` request param," not "build new board rendering."
3. **There is a SECOND, client-side prose seam this spec must also close.** `StylistChat` parses `m.text` for multi-outfit display via `isMultiOutfitResponse(m)` and `getEditorialNotes(m.text)` ([StylistChat.jsx:4465](../src/components/StylistChat.jsx:4465), [:4300](../src/components/StylistChat.jsx:4300)). Part 4's deletion list names only the *server-side* function; the client-side detectors are a distinct prose-parse seam. Move both, or deleting one leaves the other silently reparsing prose.

---

## Why this spec exists (not just "harden the parser again")

Spec 1 and the earlier stale-parser fix both patch symptoms of the same structural problem: **the model hand-writes markdown, and something downstream tries to regex it back into structured data.** Every time the prompt's format evolves, that seam can silently break again — it already has once. The fix isn't a better regex; it's removing the seam. The composer never has this problem because it was never shaped this way — it emits `{pieceIds}` JSON directly. Freeform chat should too, without losing the conversational qualities (context-locking, iterative correction, "Current outfit set" editing) that make it good.

## Part 1 — Slot schema with explicit roles, not positions

Replace implicit "top/bottom/shoes" counting with explicit roles per piece in a proposal:

```js
role: 'primary_top' | 'layer_top' | 'primary_bottom' | 'layer_bottom' | 'dress' | 'shoes' | 'outerwear' | 'accessory'
```

- **Validity rule (replaces the old rigid one-top-one-bottom check):** exactly one `shoes`; exactly one of (`primary_top` AND `primary_bottom`) OR one `dress`; any number of `layer_top`/`layer_bottom`/`outerwear`/`accessory`, each requiring a `layerOf` reference or the outfit's structure making the relationship self-evident (e.g., a `layer_top` is worn with/under/over the `primary_top`, not a second unrelated top competing for the same visual role).
- **Malformed vs. intentional, now representable, not inferred:** two `primary_top` roles in one proposal is invalid (unresolved slot collision — the model failed to decide, not a style choice) and fails validation with a clear reason. One `primary_top` + one `layer_top` is valid layering. This directly fixes the ambiguity spec 2's predecessor (the silent-piece-drop spec) worked around by assumption rather than by design.
- Existing `STYLIST_SYSTEM` layering language ("Layering Logic & No Double-Vests," outerwear-category requirement) becomes validation logic here instead of a prompt instruction the model must remember — mechanically enforced, matching this arc's core doctrine.

## Part 2 — New tool: `propose_outfit`

```json
{
  "name": "propose_outfit",
  "description": "Propose a structured outfit from verified wardrobe pieces (call search_wardrobe first to get real IDs). Use this instead of writing outfit sections in prose.",
  "parameters": {
    "label": "string — creative title",
    "occasion_context": "string — the vibe/style lane",
    "why_it_works": "string — brief styling rationale",
    "pieces": [{ "id": "number", "role": "primary_top|layer_top|primary_bottom|layer_bottom|dress|shoes|outerwear|accessory", "layerOf": "number|null — id of the piece this layers with, if role is layer_*" }],
    "missing_gaps": ["string — e.g. 'lightweight rain shell' — for slots the wardrobe can't fill; use instead of inventing a piece"]
  }
}
```

`STYLIST_SYSTEM`'s "Proposing Outfits" and "Current Outfit Set" sections rewrite to instruct calling `propose_outfit` once per outfit instead of writing `### Outfit N` markdown. The model still writes conversational prose *around* the call (intro, transitions, follow-up questions) — only the outfit's structural content moves to the tool call. This preserves the good conversational qualities while eliminating the parse-from-prose step entirely.

## Part 3 — Client-side rendering

`propose_outfit` results are routed into the **existing** structured board path — pass the tool's `pieces` into `/generate-outfit-boards`'s `structuredOutfits` request param so `boardPlanFromStructuredOutfits` (already present, see scope correction #2) produces the board plans, bypassing the prose parser. `boardPlanFromStructuredOutfits` already handles `missingPieces` → `[missing wardrobe gap]` labels and the piece-thumbnail board render. The client work is mainly feeding the tool result to that param and dropping the `m.text`-based `isMultiOutfitResponse`/`getEditorialNotes` detection — not building a new card component. Map `role` onto the board render (primary prominent, `layer_*` attached/nested) as an incremental addition to the existing renderer.

## Part 4 — Retire the prose parser once callers migrate

Two seams to retire, not one (see scope correction #3):
- **Server-side:** `structuredOutfitsFromGeneratedText`, `extractPiecesLine`, `extractWhyLine`, `extractWatchLine`, `piecesMentionedInLine` become dead once the `/generate-outfit-boards` `conceptsText` fallback branch ([routes/ai.js:2869](../routes/ai.js:2869)) is unreachable — i.e. once `propose_outfit` always supplies `structuredOutfits`. Keep the LLM re-planner fallback (the third tier) unless design decides otherwise. Grep-confirm `structuredOutfitsFromGeneratedText` has no caller besides that one branch before deletion (currently true: sole caller is routes/ai.js:2870).
- **Client-side:** `isMultiOutfitResponse` / `getEditorialNotes` and the `m.text.split('\n')` outfit interpretation in `StylistChat.jsx`. Don't delete the server functions and leave these live — they're the same prose-parse class of bug in the client.

## Part 5 — "Current Outfit Set" persistence

The multi-outfit trip-planning state (currently a prose convention re-parsed each turn) becomes structured thread state — a list of `propose_outfit` results keyed by label, updated in place when the user revises one entry, exactly matching today's *intent* ("update that named entry... instead of leaving the new idea as a loose note") but now mechanically true instead of relying on the model re-reading its own prior prose correctly every turn.

## Tests

1. ✗ Layering fixture: one `primary_top` + one `layer_top` (referencing it via `layerOf`) validates successfully; two `primary_top` roles in one proposal fails validation with a clear "unresolved top slot" reason.
2. ✗ `propose_outfit` end-to-end: a mocked model response calling the tool renders correctly client-side with no prose-parsing step involved.
3. Missing-gap handling: a proposal with a `missing_gaps` entry renders the gap label, doesn't attempt to resolve it as a piece.
4. Current Outfit Set: revising one outfit in a multi-outfit trip thread updates that entry in structured state; other entries unchanged.
5. Regression: conversational quality preserved — context-locking, correction storage (`store_user_correction`), and "don't repeat advice" behaviors unaffected by the tool-call migration (these are prompt/conversation-level, not proposal-structure-level, but worth an explicit check that nothing coupled to prose parsing broke them).
6. Dead code removal: confirm zero remaining callers of the retired prose-parser functions before deletion; `npm test` green after removal.

## Out of scope

- Gate enforcement itself — spec 1's job, should already be true before this spec changes the output format.
- Diagnostic/observability parity — spec 3.
- Redesigning the composer's own JSON schema (unrelated, already correct).

## Sequencing note

This is a bigger bet than anything else in the freeform-chat sequence — genuinely worth a design pass with the coder before implementation starts, not just a build-from-spec. Flag for discussion: the `layerOf` reference adds real complexity to both the schema and the validator: confirm this granularity is worth it versus a simpler "role: top|bottom|shoes|layer|accessory" (no explicit `layerOf` linking, just a looser "layer" bucket) if that turns out sufficient for how layering actually gets described in practice.
