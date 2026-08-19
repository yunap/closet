# Freeform deferred-tool experiment

**Status:** HISTORICAL — implemented, never validated live, **removed from the code 2026-08-19**
**Flag:** `WARDROBE_FREEFORM_DEFERRED_TOOLS` no longer exists; setting it does nothing

> **Why it was removed.** It measurably reduced visible schema size and did not touch the
> iteration/cache pattern that actually drives turn cost — cache writes compound per tool-loop
> iteration, and deferring tool *definitions* changes none of that. Batched discovery changes the
> premise by collapsing the sequential loop itself, so preserving provider-specific deferral
> machinery would have constrained that redesign without a demonstrated benefit. No paid validation
> ever ran.
>
> **What survives.** The measurements below are the record: 14 tools / ~29,079 JSON characters /
> ~7,274 rough tokens, with five eager tools at ~12.7k characters. If a future design wants to shrink
> the tool catalog, start from these numbers rather than re-measuring — but first confirm the cost
> model, because schema size was not the binding constraint. See
> [freeform-batched-discovery-spec.md](freeform-batched-discovery-spec.md).

## Decision

Run a provider-specific experiment on the Anthropic full-stylist loop only. Do not change the OpenAI
Chat Completions path.

The current full catalog is 14 tools and approximately 29,079 JSON characters / 7,274 rough tokens.
The five eager tools account for approximately 12.7k characters / 3.2k rough tokens; deferring the
other nine keeps more than half the schema characters out of Claude's initial context.

Anthropic documents tool search for catalogs with 10+ tools, says deferred definitions are excluded
from the rendered system prefix, and says discovery appends definitions without invalidating that
prefix cache. The request still sends every definition to the API. See the official
[tool-search guide](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
and [prompt-caching interaction](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching).

OpenAI's `allowed_tools` restricts invocation while still listing the full tool universe; it is not
context deferral. Provider-native tool search is a Responses/model capability, while this app's
OpenAI loop currently uses Chat Completions with `gpt-4o`. That path remains byte-for-byte unchanged.
See OpenAI's official [model/tool guidance](https://developers.openai.com/api/docs/guides/latest-model).

## Request shape

`anthropicDeferredToolPlan` activates only when all are true:

- the feature flag is on;
- provider is Anthropic;
- the configured Claude model is in the documented supported family;
- at least ten tools remain available for the turn.

It prepends Anthropic's BM25 server tool search and keeps these five client tools eager:

1. `declare_intent`
2. `search_wardrobe`
3. `view_pieces`
4. `store_user_correction`
5. `propose_outfit`

The other nine receive `defer_loading:true`. No deferred tool receives `cache_control`. Completed
atomic/slot-swap turns still expose no tools exactly as before.

## Loop and fallback

Server `tool_search_tool_bm25` blocks are recorded but never passed to `executeTool`; Anthropic runs
them. Discovered ordinary `tool_use` blocks continue through the existing local executor. A 400
whose message identifies unsupported/invalid tool search or deferred loading retries that iteration
once with the unchanged full catalog. Authentication, rate-limit and unrelated request failures do
not retry under this fallback.

Generation diagnostics persist:

- deferred-mode provider iterations;
- actual server tool-search calls;
- compatibility fallbacks;
- schema characters hidden from initial context across iterations;
- `tool_search` in the existing tool-sequence trace.

No conversation text or tool-search query is added to diagnostics.

## Acceptance before default-on

Offline:

- provider/model/size eligibility is exact;
- OpenAI, unsupported models and small catalogs are no-ops;
- eager/deferred membership is frozen by test;
- server search cannot reach the client executor;
- compatibility fallback restores the original catalog;
- prompt, style, documentation and text-matching guards pass.

Live, owner-approved only:

- test one ordinary text turn needing no deferred tool;
- test one slot swap, one plan/capsule request and one render/evaluation request;
- compare tool selection, provider iterations, input/cache tokens, latency, fallback count and final
  answer quality against flag-off runs;
- ship default-on only if total cost falls and no request class loses the correct tool.

Because this catalog is only about 7.3k rough tokens—not the 55k-scale example in Anthropic's
documentation—the experiment may be too small to repay search latency. The flag exists to measure,
not to assume.
