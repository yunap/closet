# Spec 22: AI retag is broken on the Anthropic provider — `detail` field rejected (hotfix)

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
**Priority:** HOTFIX — a live-broken feature, not a cleanup. AI retagging fails outright whenever `AI_PROVIDER=anthropic` (the default since the PR #105 flip made anthropic the daily driver). Small enough to ship same-day; independent of specs 14/20/21.
**Files touched:** `styling-engine/provider.js` (Anthropic message sanitizer), tests. `routes/ai.js:749` stays as-is (see fix rationale).

## Live evidence (2026-07-16, wardrobe-dev.log.claude9)

```
AI retag error: BadRequestError: 400 {"type":"error","error":{"type":"invalid_request_error",
"message":"messages.0.content.6.image.detail: Extra inputs are not permitted"}}
  at askClaudeWithUsage (styling-engine/provider.js:496)
  at askStylist (styling-engine/provider.js:578)
  at tagPieceWithProvider (routes/ai.js:781)
  at tagExistingHandler (routes/ai.js:1317)
```

Any retag attempted on the Anthropic provider dies with this 400; the piece's tags are never updated. (The owner's retag of piece 258 during this session silently never applied.)

## Root cause

[routes/ai.js:749](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/routes/ai.js:749) builds the tagger's image blocks as `{ type: 'image', detail: 'low', source: {...} }`. `detail` is an **OpenAI** concept: `contentToOpenAI` ([provider.js:438](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/provider.js:438)) reads the part-level `detail` and moves it into `image_url.detail` for the OpenAI request — but the Anthropic path (`askClaudeWithUsage`) passes content blocks to `client.messages.create` verbatim, and the Anthropic API rejects unknown fields on image blocks.

History: the identical bug existed in the tool loop's image blocks and was fixed in PR #103 by deleting the field there. This is the missed sibling site — it never surfaced earlier because the tagger only ran on OpenAI until the provider flip. Same failure class both times: an internal message shape that is a superset of what one provider accepts, sent unsanitized.

## Fix — sanitize at the Anthropic sender, not at every builder

Do NOT just delete `detail: 'low'` at routes/ai.js:749 — that field is load-bearing for the OpenAI path (it caps tagger image cost at low detail), and whack-a-mole at builder sites is how this bug shipped twice. Fix the class:

In provider.js, add a `toAnthropicContentBlocks(content)` normalizer applied to every message's content in the Anthropic request paths (`askClaudeWithUsage`, and the tool-loop branch of `askStylistWithTools` — the latter currently has no `detail` fields but gets the same protection):

- String content passes through unchanged.
- `text` blocks: keep `{ type, text }` (+ `cache_control` if present).
- `image` blocks: keep `{ type: 'image', source }` (+ `cache_control` if present) — part-level extras like `detail` are dropped.
- `tool_result` / `tool_use` blocks: pass through with `cache_control` preserved (their inner content runs through the same normalizer).
- **Must not strip `cache_control`** — the spec-16 moving breakpoint depends on it; add an explicit test.

Composes with `withMovingCacheBreakpoint` (order: sanitize first, then the breakpoint marks the last block, or verify the combined result both ways — the breakpoint's annotation must survive).

## Tests

- Unit: `toAnthropicContentBlocks` drops `detail` from image blocks, preserves `source`/`text`, preserves `cache_control` on both text and image blocks, passes strings through.
- Retag path shape test: build the tagger's message (the routes/ai.js:749 shape with `detail: 'low'`), run it through the Anthropic path's formatting, assert no `detail` key anywhere in the payload; run the same content through `contentToOpenAI`, assert `image_url.detail === 'low'` still present (OpenAI behavior unchanged).
- Existing spec-16 caching tests stay green (breakpoint still lands).

## Verification (live)

Retag any piece with photos on `AI_PROVIDER=anthropic` — tags apply, no 400 in the log. Re-run the retag of piece 258 (the crop top) that silently failed on 2026-07-16.

## Risks

Low. The sanitizer is an allowlist over block shapes the code already produces; the one field it drops is one the Anthropic API hard-rejects today. OpenAI path untouched.
