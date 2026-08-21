# Model-call telemetry

**Status:** implemented 2026-08-20

This is the durable, call-level spend ledger for model-facing flows. It was added after the AI-flow census showed that `/ask` had detailed turn diagnostics while most other flows either returned usage only in `debug`, logged it to the console, or discarded it. The purpose is to make one query answer: **what did the app spend, by flow, provider, model, and call type?**

## Boundary

Telemetry is installed once at each SDK's shared `fetchWithTimeout` transport boundary by `lib/installAiCallTelemetry.js`. Both installed SDKs use their own Node runtime shim (`node-fetch`) rather than `globalThis.fetch`, so a global-fetch monkeypatch does not observe real production traffic. The SDK boundary sits immediately above that native transport: every actual provider HTTP attempt crosses it, including SDK retries, while the SDK keeps its normal networking implementation unchanged.

This is deliberately below individual prompt builders and route-specific model wrappers. A new model-facing flow automatically appears in the ledger if it uses the existing Anthropic/OpenAI SDK clients. No prompt, model-selection, provider-routing, gate, response contract, or retry policy is changed by this layer.

## `ai_call_log`

The table is additive. `lib/installAiCallTelemetry.js` ensures it for the default database during server bootstrap, `runWithAiTelemetryContext` ensures it again while each authenticated user's request-scoped database context is active, and `logAiCall` ensures it defensively before writing. `CREATE TABLE IF NOT EXISTS` is intentionally not cached by user id: a deleted/recreated test or user database must never inherit stale in-memory "already initialized" state.

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

A non-2xx provider response is logged as a failed call before the SDK decides whether to retry it. Because retries re-enter `fetchWithTimeout`, each retry is a separate ledger row. Network exceptions are logged and then rethrown unchanged. Telemetry failures themselves are swallowed and warned; they must never turn a successful stylist request into an application failure.

## Verification without paid calls

`test/ai_call_telemetry.test.js` instantiates the real installed Anthropic and OpenAI SDK clients with an explicit synthetic `fetch` implementation. The telemetry patch is above that injected transport, so the test proves the same `fetchWithTimeout` boundary production uses without allowing any real network traffic. It covers Anthropic/OpenAI usage normalization, cache tokens, image-call classification, provider failures, and route attribution.

`WARDROBE_MOCK_AI` still short-circuits before an SDK request. `lib/mockAiCallTelemetry.js` writes equivalent verification rows with `is_mock=1`, `provider='mock'`, zero tokens, and zero cost. Those rows are excluded from spend totals.

## Reporting

`scratch/report_ai_spend.js` follows the database-safety convention used by the existing measurement scripts: every discovered wardrobe database is copied with its WAL/SHM files to a temporary directory before being opened read-only.

Without `WARDROBE_DB_PATH`, it reports across both the legacy root `./wardrobe.db` and every `data/users/*/wardrobe.db` (or `WARDROBE_USERS_DIR/*/wardrobe.db`) and aggregates matching flow/provider/model rows across users. With `WARDROBE_DB_PATH`, it reports only that explicitly selected database.

Examples:

```bash
node scratch/report_ai_spend.js
node scratch/report_ai_spend.js --since '2026-08-20 00:00' --until '2026-08-21 00:00'
node scratch/report_ai_spend.js --flow outfit_feedback
```

The report groups non-mock calls by flow, endpoint, provider, model, and image/text kind, summing calls, tokens, cache traffic, estimated cost, and failures. It also prints how many databases were scanned and how many contained the telemetry table.

## Known boundary

Mock image-render paths that deliberately choose a local collage do not write an `image` row, because no provider call was attempted. Production accounting remains one row per actual provider HTTP attempt.

Transport-level flow attribution follows the visible HTTP route. Internal sub-calls therefore remain grouped under their parent route unless code explicitly adds a nested subflow later: `/ask`'s internal profiles remain `flow='ask'`, and crop verification/relocation performed inside the importer detect route remain `flow='importer_detect'`. This is deliberate; add an explicit subflow field if that distinction becomes important rather than parsing prompt text.
