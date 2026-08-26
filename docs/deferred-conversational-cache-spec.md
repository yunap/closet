# Spec — Deferred conversational cache activation across stylist entry flows

**Status:** Implemented 2026-08-25. Extended 2026-08-26 to a second, unrelated cache write found
while measuring the first fix's real-world savings — see "Part 2" below.

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

---

## Part 2 — the candidate image-manifest cache (found while measuring Part 1)

Measuring Part 1's real dollar impact against recent `wardrobe.db` history surfaced a **second,
unrelated** cache write on the whole-wardrobe composer: 30–49k tokens written on essentially every
call, ~$0.12-0.18 of each ~$0.15-0.21 call. It is not `PROMPT_CACHE_BREAKPOINT` — it's a plain
`cache_control: {type:'ephemeral'}` (default 5-minute TTL) that had been attached directly to the
last candidate thumbnail in the *message content*, at what is now the comment site in
`generateWholeWardrobeOutfitsVisualInternal` (`routes/ai.js`), so that "the entire candidate
manifest is cached." This function has three callers, all sharing the one breakpoint:
`/generate-wardrobe-outfits-visual` (standalone whole-wardrobe generation), `/generate-saved-outfit-
variants`, and freeform `/ask`'s `generate_outfits` tool (`whole_wardrobe` branch, `nested_composer`
subflow in `styling-engine/tools.js`).

### Same-turn retry protection? No — traced and ruled out

The function makes exactly **one** provider call, no retry-on-failure loop, no repair re-call
(`composerErrorIsTruncation` is recorded as a diagnostic only). So this cache can never be read back
*within* the call that wrote it. Contrast the capsule roster prompt cache (`engine-behaviour-map.md`
§Caches), which genuinely has an attempt-1-writes/attempt-2-repairs relationship — this one does
not. Any reuse could only come from a **separate, later** call landing within the default 5-minute
TTL with an identical roster/image set. Checked whether session-recency exclusion would defeat that
even when it happens: it doesn't — `sessionInfluence` (recency penalty) is applied only to
*post-response* candidate-outfit scoring, not to which pieces/images get sent, so the roster itself
is gate-based only and can legitimately repeat across close-together calls.

### Cache attribution added to measure it precisely

Per-call telemetry can't distinguish cache mechanisms by itself — Anthropic reports one
`cache_read_input_tokens` number per call for however much of the whole `tools → system → messages`
prefix matched, and one `cache_creation_input_tokens` number, though creation *is* split by TTL
bucket (`cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`). Added to
`normalizeAiUsage` (`provider.js`) and threaded through by call site:

- **`recordNestedFreeformUsage`** (`tools.js`) — exact attribution to the image-manifest cache,
  gated on `toolContext.source === 'whole_wardrobe'` (the sibling `selected_piece` branch has no
  breakpoint at all, so it's excluded rather than assumed). This call is always a fresh, one-off
  `messages` array with an unmarked system prompt, so 100% of whatever cache activity shows up is
  this one breakpoint.
- **`recordToolLoopUsage`** (`provider.js`), new optional `{cacheSite:'tool_loop'}` — applied only
  at `askStylistWithTools`'s own Anthropic call, the *one* caller where a TTL split cleanly
  separates two named caches: `ephemeral_1h` can only be the freeform stable-system breakpoint
  (`systemToAnthropicBlocks` is the sole `ttl:'1h'` cache_control in the codebase), and the loop's
  only other breakpoint is the 5m moving-message one (`withMovingCacheBreakpoint`), so whatever 5m
  write remains there is unambiguously that. Every other `recordToolLoopUsage` caller (compact
  router, capsule roster/composition calls) is deliberately left untagged — some carry no
  breakpoint, and the capsule roster call carries a *different* 5m breakpoint that a blind TTL split
  would have wrongly folded into "moving message."

New `freeformDiagnostics` fields (all additive, all in the same `debug` blob already persisted to
`chat_threads`): `providerImageManifestCacheReadTokens`, `providerImageManifestCacheCreationTokens`,
`providerFullStylistSystemCacheCreationTokens`, `providerMovingMessageCacheCreationTokens`,
`providerToolLoopCacheReadTokens`. The standalone route needed no changes — its `debug.composerUsage`
already carries the full split via `normalizeAiUsage`, and it's 100% attributable by construction
(no other breakpoint in that call).

### Measured, then removed

Historical (prior 4 days, 7 standalone calls): 0 reads against 30–49k written tokens on every call.
Two fresh live calls run specifically to test this — one standalone whole-wardrobe generation, one
freeform `generate_outfits` — both landed on `providerImageManifestCacheReadTokens: 0` against
47,161 and 39,559 written tokens respectively. **0 reads across every sample checked.** The
immediate "give me more" follow-up in the freeform trial didn't even re-invoke `generate_outfits` —
it escalated to `full_stylist` and answered via `propose_outfit` instead, which incidentally
confirmed Part 1's fix working correctly: that turn established the freeform stable-system cache for
the first time in the thread (`providerFullStylistSystemCacheCreationTokens: 39,299`) and then read
it back heavily across its own iterations (`providerToolLoopCacheReadTokens: 319,635`) — the
intended, already-correct behavior, undisturbed.

The `cache_control` on the candidate manifest was removed. No other behavior changed; this is a pure
cost removal on a write that never once paid for itself in any sample measured.

### Tests

- `whole-wardrobe generation does not cache_control the candidate image manifest either`
  (`test/aiEndpointContracts.test.js`) — hits `/generate-wardrobe-outfits-visual` and asserts no
  block in the sent content array carries `cache_control`.
- `bumpFreeformDiagnostic initializes and accumulates counters on toolContext`
  (`test/freeform_observability.test.js`) — updated for the five new default fields.
