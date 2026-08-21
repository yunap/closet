# Model-call telemetry

**Status:** implemented 2026-08-20

This is the durable, call-level spend ledger for model-facing flows. It was added after the AI-flow census showed that `/ask` had detailed turn diagnostics while most other flows either returned usage only in `debug`, logged it to the console, or discarded it. The purpose is to make one query answer: **what did the app spend, by flow, provider, model, and call type?**

## Boundary

Telemetry is installed once at the provider HTTP boundary in `lib/aiCallTelemetry.js` and `server.js`. It observes only requests to `api.anthropic.com` and `api.openai.com` and writes one `ai_call_log` row per actual provider round-trip.

This is deliberately below individual prompt builders and route-specific model wrappers. A new model-facing flow automatically appears in the ledger even if its author forgets to add a telemetry argument. It also means SDK/provider retries are visible as separate paid calls rather than being hidden inside one route-level aggregate.

No prompt, model-selection, provider-routing, gate, or response behavior is changed by this layer.

## `ai_call_log`

The table is additive. `lib/installAiCallTelemetry.js` ensures it for the default database during server bootstrap, and `runWithAiTelemetryContext` ensures it again on the first authenticated API request for each user while that user's request-scoped database context is active. `logAiCall` also ensures it defensively before writing. The schema therefore exists before the first paid model call rather than appearing only as a side effect of spend.

- `flow`, `endpoint`, `session_id`
- `call_kind`: `text`, `structured`, `tool_loop`, or `image`
- `is_image`
- `provider`, `model`
- `success`, `error_message`, `latency_ms`
- input/output/cache-read/cache-creation/total token counts
- `estimated_cost_usd`
- `is_mock`
- bounded JSON `context`
- `created_at`

`freeform_generation_runs`, `generation_runs`, feedback-synthesis accounting, and importer spend remain untouched. They keep their narrower diagnostic/product responsibilities. `scratch/feedback_surface_inventory.json` classifies `ai_call_log` as operational telemetry rather than user memory, alongside the two existing generation diagnostic tables.

## Attribution

`server.js` binds the incoming authenticated API request to `AsyncLocalStorage`. `classifyAiFlow()` maps the visible endpoint to the census flow vocabulary (`ask`, `outfit_feedback`, `whole_wardrobe_composer`, importer phases, image flows, and so on). That context survives downstream async helpers, so provider calls do not need telemetry parameters threaded through every function.

Calls outside an attributed API request are still recorded as `unattributed` rather than silently dropped.

## Usage and cost

Provider response usage is normalized for:

- Anthropic message usage, including cache read/creation tokens;
- OpenAI Chat Completions usage;
- OpenAI Responses usage.

Text-call pricing delegates dynamically to `styling-engine/provider.js`'s existing `estimateAiUsageCost`, so this ledger does not create a second text-pricing table. Image-generation tool calls use a documented flat approximation (`$0.07` per paid image-provider call) because the image tool is not billed like ordinary response text tokens.

Telemetry failures are swallowed and warned; they must never turn a successful stylist request into an application failure.

## Mock verification

`WARDROBE_MOCK_AI` and ordinary test responses short-circuit before the provider HTTP boundary. `lib/mockAiCallTelemetry.js` wraps the existing canned-response handler and writes equivalent verification rows with `is_mock=1`, `provider='mock'`, zero tokens, and zero cost. Those rows prove route attribution and schema writes without pretending a provider was billed, and `scratch/report_ai_spend.js` excludes them from spend totals.

## Reporting

`scratch/report_ai_spend.js` follows the database-safety convention used by the existing measurement scripts: it copies `wardrobe.db` plus WAL/SHM to a temporary directory before opening it read-only.

Examples:

```bash
node scratch/report_ai_spend.js
node scratch/report_ai_spend.js --since '2026-08-20 00:00' --until '2026-08-21 00:00'
node scratch/report_ai_spend.js --flow outfit_feedback
```

The report groups non-mock calls by flow, endpoint, provider, model, and image/text kind, summing calls, tokens, cache traffic, estimated cost, and failures.

## Known boundary

Mock image-render paths that deliberately choose a local collage do not write an `image` row, because no provider call was attempted. A test that needs to exercise the image-row schema can call `logAiCall({ isMock: true, isImage: true, callKind: 'image' })` directly; production accounting remains one row per actual paid provider round-trip.

Transport-level flow attribution follows the visible HTTP route. Internal sub-calls therefore remain grouped under their parent route unless code explicitly adds a nested subflow later: `/ask`'s internal profiles remain `flow='ask'`, and crop verification/relocation performed inside the importer detect route remain `flow='importer_detect'`. This is deliberate; add an explicit subflow field if that distinction becomes important rather than parsing prompt text.
