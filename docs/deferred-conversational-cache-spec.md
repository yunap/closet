# Spec — Deferred conversational cache activation across stylist entry flows

**Status:** Implemented 2026-08-25.

**Authority:** Extends `freeform-prompt-cache-levers.md`'s cache-shape work to *whether* a thread
establishes the 1h conversational cache at all, not just what sits inside it. Traced against
`message-lifecycle.md`'s dispatch table, which turned out to already solve most of this problem.

## Goal

Avoid paying the full conversational cache-write cost (`cache_control: {type:'ephemeral',
ttl:'1h'}` on the stable prefix — tools, wardrobe manifest, occasion profiles, style constitution,
or an evaluator's own stable text) for threads that begin as one-shot stylist actions and never
become conversations.

## The mechanism

`PROMPT_CACHE_BREAKPOINT` (`styling-engine/provider.js`) is a text marker. `systemToAnthropicBlocks`
splits a system string on it and attaches the 1h ephemeral `cache_control` to everything before the
marker. **Presence of the marker in a call's system string is the entire cache-write decision** — no
marker means no system-level caching at all (plain text, full price every call, no write to
amortize). There is no separate on/off flag; disposition is decided per call site by whether that
call's system string contains the marker.

## Trace — where each entry path stood before this spec

| Entry path | Owner | Marker present? |
|---|---|---|
| Freeform `/ask`, turn 1 | `buildStylistConversationPayload` → `STYLIST_SYSTEM` (`core.js`) | Yes — correct, unchanged |
| Selected-item generation | `/generate-outfits-for-piece` handler (`routes/ai.js`) | No — already correct, unchanged |
| Whole-wardrobe generation | `generateWholeWardrobeOutfitsVisualInternal` (`routes/ai.js`) | **Yes, unconditionally** — avoidable write |
| Critique/feedback (`full` and `followup`) | `evaluateOutfitThroughSharedPipeline` (`core.js`) | **Yes, unconditionally, on both response modes** — avoidable write, and never reused even across turns of the same pipeline, since `full` and `followup` are different system text |

## Follow-up routing already does the hard part

The client dispatcher (`message-lifecycle.md` Stage 1) decides where a follow-up message goes, and
that decision — not anything in this spec — is what determines whether a follow-up can read back a
cache:

- **Whole-wardrobe / selected-item follow-ups** (dispatch branches 11–12) land on `/ai/ask`, the
  same execution router ordinary freeform uses. That router already returns early from compact
  paths (`compactFreeformAnswerSystem` — no marker, ever) and only calls
  `buildStylistConversationPayload` (marker, cache write) once it falls through to `full_stylist`.
  **This was already exactly the desired disposition — nothing needed changing here.**
- **Critique follow-ups** (dispatch branch 10) go straight back to `evaluateOutfitThroughSharedPipeline`
  with `responseMode:'followup'`, a separate pipeline that never touches `/ask`'s router. Its `full`
  and `followup` variants use different system text, so a marker on either would never be read back
  by the other — there was never a reuse opportunity to protect here, only a wasted write to remove.

## Changes made

Two call sites had their `PROMPT_CACHE_BREAKPOINT` concatenation removed — both single-owner
functions, no new prompt/composer/route introduced:

1. **`wholeWardrobeVisualComposerSystemPrompt`** (`routes/ai.js`, used by
   `generateWholeWardrobeOutfitsVisualInternal`) — no longer writes the 1h cache. A follow-up on the
   generated outfits still reaches `/ai/ask`'s own full_stylist disposition, which uses a wholly
   different stable prefix (text manifest, not the image-heavy roster), so there was nothing this
   write could ever hand off to.
2. **`outfitEvaluationSystemPrompt`** (`core.js`, used by `evaluateOutfitThroughSharedPipeline`) —
   no longer writes the 1h cache on either `full` or `followup`.

`selectedItemVisualComposerSystemPrompt` (`routes/ai.js`) was extracted from an inline template
literal for symmetry and testability; it never carried the marker and its behavior is unchanged.

Nothing about tool schemas, prompts, routes, or state stores was duplicated — each one-shot path
already had exactly one function that builds its system prompt, and that is the function this spec
edited.

## Tests (`test/aiEndpointContracts.test.js`)

- freeform `/ask` establishes the conversational cache on turn 1
- whole-wardrobe generation, selected-item generation, and critique/feedback (`full` and
  `followup`) all build a system prompt with no `PROMPT_CACHE_BREAKPOINT`
- a compact freeform follow-up profile never carries the marker
- a one-shot entry (whole-wardrobe generation) followed by a question the compact router can't
  answer still escalates to `full_stylist` and gets the cache established on that turn
- two consecutive full-stylist turns keep a byte-identical stable prefix, so the second turn can
  read the first turn's cache

State/result persistence (generated cards, `generation_runs`/`whole_wardrobe_sessions` rows, saved
critique feedback) was not touched by this change and is covered by the pre-existing tests for each
endpoint.
