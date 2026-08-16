# Spec 16: Conversation prompt caching for the tool loop — stop re-paying tool results every round-trip

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
**Priority:** High — this is the single biggest token lever in the app, and it benefits EVERY multi-tool `/ask` turn, not just plans. Independent of spec 15; ships alone.
**Files touched:** `styling-engine/provider.js` (Anthropic branch of `askStylistWithTools`), tests.

## Finding

PR #42 added prompt caching to the **system prompt only**: `systemToAnthropicBlocks` puts `cache_control` on the stable prefix ([provider.js:518](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/provider.js:518)). The **conversation messages carry no cache_control at all** — `messages: formattedMessages` at [provider.js:694](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/provider.js:694) sends plain blocks.

Consequence: in a tool loop, every tool result — including `view_pieces` image batches and the model-mode plan workbench — is re-sent and **re-billed at full input price on every subsequent iteration** of the same turn. The live Paso model-mode turn made ~9 API calls (declare → plan → 4× view_pieces → 3× submit); the ~54 thumbnails and the ~3–4k-token workbench entered the conversation mid-turn and were then re-read at full price by every call after them. This, not the validator, is where the plan turn's tokens actually went. The same tax applies to every ordinary freeform turn with 3+ tool calls.

## Fix — a moving cache breakpoint on the last message

Anthropic allows up to 4 `cache_control` breakpoints per request; the system prefix uses 1. Add one **moving** breakpoint in the messages array: on each API call, mark the final content block of the final message with `cache_control: { type: 'ephemeral' }`, and strip any message-level cache_control set on a previous iteration (so the request never accumulates stale breakpoints toward the 4-cap).

```js
// provider.js, Anthropic branch — replace the plain map:
const formattedMessages = withMovingCacheBreakpoint(
  currentMessages.map(m => ({ role: m.role, content: m.content }))
)

function withMovingCacheBreakpoint(messages = []) {
  const cleaned = messages.map(m => ({
    role: m.role,
    content: typeof m.content === 'string'
      ? m.content
      : m.content.map(({ cache_control, ...block }) => block)   // strip prior marks
  }))
  const last = cleaned[cleaned.length - 1]
  if (!last) return cleaned
  const blocks = typeof last.content === 'string'
    ? [{ type: 'text', text: last.content }]                    // strings can't carry cache_control
    : last.content.map(block => ({ ...block }))
  if (blocks.length) blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } }
  cleaned[cleaned.length - 1] = { ...last, content: blocks }
  return cleaned
}
```

How it pays: on iteration N, everything up to the breakpoint is written to cache (one-time ~25% write premium); on iteration N+1 the entire prior conversation — system, workbench, images, tool results — is a cache **read at ~10% of input price**, and only the newest tool result is full-price. For a 9-call turn this converts ~8 re-reads of a growing 25–35k-token context from full price to one-tenth. Image blocks are cacheable like text. The 5-minute TTL comfortably covers intra-turn iterations (seconds apart).

Nested `tool_result` content note: the breakpoint must land on a block the API accepts `cache_control` on. For a `tool_result` message, set it on the **outer** `tool_result` block (the `content: [{ type: 'tool_result', … , cache_control }]` element), not on the nested inner blocks — adjust `withMovingCacheBreakpoint` to detect that shape (the last message the loop pushes is always either a plain text correction, the OpenAI-style user image message, or a `tool_result` array).

## Scope guards (mirror PR #42's pattern exactly)

- **Anthropic branch only.** The OpenAI branch and the `NODE_ENV=test` short-circuit never see cache_control — strings are stripped/ignored exactly as `systemToAnthropicBlocks`'s OpenAI counterpart already does. No behavior change anywhere but the Anthropic request payload.
- **No semantic change:** the blocks' content is byte-identical; only the annotation is added. If the API ever rejects a `cache_control` placement, that's a hard error in dev, not silent degradation — do not try/catch-swallow it.
- Breakpoint budget check: 1 (system stable prefix, existing) + 1 (moving message mark) = 2 of 4. Room remains for a future mid-conversation pin if ever needed.

## Verification

- `normalizeAiUsage` already surfaces `cache_read_input_tokens` / `cache_creation_input_tokens` (PR #42). Log them per iteration in dev: expect iteration ≥2 of any tool loop to show `cache_read` ≈ the prior context size and full-price input ≈ just the newest tool result. A Paso-scale plan turn should show the difference immediately.
- Unit tests: `withMovingCacheBreakpoint` — string content wrapped and marked; block content marked on last block only; prior marks stripped; `tool_result` outer-block placement; empty messages no-op.
- One live A/B: run the same plan turn before/after and compare the turn's summed full-price input tokens from the usage log. Expect a 3–6× drop on multi-iteration turns.

## Why not batch/other alternatives

- Reducing iterations is spec 15's job (parts 1, 2, 6b); this spec makes the iterations that legitimately remain cheap. Both are needed: even a perfect 3-call plan turn (declare → plan → submit) re-reads the workbench twice.
- Trimming context (dropping old tool results from `currentMessages`) was considered and rejected: the model legitimately needs earlier results (rosters, seen images) in later iterations, and truncation bugs are exactly the class of silent failure this codebase's history warns about. Caching keeps everything visible and just stops re-billing it.
