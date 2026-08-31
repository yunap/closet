# Structured weather context for outfit planning

**Status:** Ratified implementation specification, 2026-08-30. The current branch is a partial,
non-conforming implementation and must not merge until every requirement in this document is
implemented. There is no deferred second phase.

**Scope:** Every `/ask` outfit-composition path: `plan_outfit_set`, `search_wardrobe`,
`propose_outfit`, and `generate_outfits`, including roster construction, submission validation,
card/thread continuity, diagnostics, and provider schema parity.

**Owner ruling, 2026-08-30:** Build one structured weather contract end to end. The model may
translate explicit user weather and may supply a seasonal estimate, but arbitrary prose is never
parsed into gate-driving weather. Live data, user weather, and model estimates keep truthful,
field-level provenance. The first proposed outfit must already be weather-valid; repair is a safety
net, not the acceptance path.

## 1. Outcome

For a future trip to Vienna, Virginia with typical highs of 65°F and lows of 45°F:

1. The model sends the destination, dates, slots, and a structured 65/45 seasonal estimate on its
   first planning call.
2. The executor attempts live weather for the requested place and dates.
3. Explicit structured user weather overrides only the physical fields the user actually stated.
4. Live weather fills the remaining fields when available.
5. The structured model estimate fills unresolved temperature fields when live weather is
   unavailable.
6. The resolved 65/45 context exists before any wardrobe roster is built.
7. The roster, workbench instructions, and validator all consume that same resolved object.
8. Cold-inappropriate bare pieces and open warm-weather footwear are absent or mechanically
   rejected before the first outfit can be accepted.
9. Cards and follow-up state retain the exact range and provenance.

The model should not propose the tank top plus sandals in the first place. It receives a roster and
submission contract already constrained by resolved weather. `submit_plan_outfits` remains a
last-line validator for model mistakes, not the mechanism that normally makes an outfit wearable.

## 2. Why the current approach must be replaced

The live failure was not a missing weather gate and not a failure to call `plan_outfit_set`. Both
providers called the planner. The executor allowed model-authored prose such as `crisp outdoor
walking weather` and `indoor dinner temperature` to become authoritative physical weather, while
a failed future forecast became a neutral profile. The model separately knew Vienna in October was
around 65°F/45°F, but those numbers never reached the object consumed by the roster and gates.

The attempted `stated_user` repair introduced a second problem: it tried to recover authoritative
weather by regex-scanning arbitrary request prose. Dates, outfit counts, Celsius values, ranges,
condition words, and style phrases such as “warm colors” then became parser edge cases. Each regex
patch exposed another ambiguity because natural-language style prose is not a weather data format.

The fix is architectural:

- the model translates language into a typed tool argument;
- deterministic code validates and resolves typed fields;
- all physical consumers read one resolved object;
- display prose never becomes physical evidence.

## 3. Non-negotiable boundaries

### 3.1 No prose-to-weather authority

Delete `currentTurnStatedWeather` and `statedUserWeatherProfile`. Remove their route wiring,
planner fields, comments, and tests. Do not replace them with another regex, keyword list, NLP
helper, or call to `extractWeatherContext`.

`extractWeatherContext` may continue serving legacy conversational/display behavior elsewhere,
but it must not populate `user_weather`, `weather_estimate`, `ResolvedWeatherContext`, or any
weather gate for the four outfit-composition tools in scope.

The existing `weather` string may remain in the HTTP request and conversational context for
backward compatibility. Remove it from the four model-facing composition tool schemas. It is not
read by roster construction or validation. There is no compatibility adapter that converts it into
physical weather.

### 3.2 Environment is separate

`environment` is the only model-facing setting field:

```text
indoor | outdoor | beach_coastal
```

`indoor` is never a temperature. An indoor slot retains outdoor resolved weather as transit
context while allowing an indoor-appropriate base outfit.

### 3.3 Code constrains; the model translates

The model decides whether the current user explicitly supplied weather and, if so, translates only
that claim into `user_weather`. The model supplies `weather_estimate` from its own seasonal
knowledge when a named destination/date may be outside live coverage. These are separate fields
because they have different provenance and precedence.

The executor validates structure, resolves precedence, classifies temperature, constrains rosters,
and validates submissions. It never decides from prose whether “cool,” “warm,” “winter,” or a
number referred to weather.

### 3.4 Unknown is not mild

An unresolved temperature has `status: "unavailable"`; it does not produce `isHot:false,
isCold:false` as though mild weather were known. A named-location/date outfit flow must stop before
roster construction when temperature remains unresolved.

## 4. Model input contract

### 4.1 Shared structured fields

All four composition tools accept the following optional fields at the plan/call level. Planner
slots accept the same fields as overrides.

```json
{
  "user_weather": {
    "precipitation": "rain"
  },
  "weather_estimate": {
    "high_f": 65,
    "low_f": 45,
    "precipitation": "unknown",
    "wind": "unknown"
  }
}
```

This example means “the user said rain; the model independently estimates 65/45.” A numeric user
statement would instead be `{"high_f":65,"low_f":45}`; a qualitative one would be
`{"temperature_band":"cold"}`. A real `user_weather` object cannot include both forms.

`user_weather` rules:

- Include it only when the current user message explicitly states the corresponding weather.
- It may contain a numeric range (`high_f` and `low_f`) or a qualitative
  `temperature_band`, but not both.
- `temperature_band` enum: `hot | cold | mild`.
- Numeric temperature requires both `high_f` and `low_f`; a single stated temperature is
  represented by setting both to the same value.
- Convert a user-stated Celsius value to Fahrenheit in the tool argument. Do not pass raw Celsius
  text to the executor.
- `precipitation` enum: `none | rain | snow | mixed | unknown`.
- `wind` enum: `calm | breezy | windy | unknown`.
- Omitted fields mean the user did not state that dimension. `unknown` means the user explicitly
  said it was unknown; it does not override a known lower-precedence value.
- At least one meaningful field is required.

`weather_estimate` rules:

- `high_f` and `low_f` are required finite numbers.
- `high_f >= low_f`.
- Both are within −100°F through 140°F inclusive.
- `precipitation` and `wind` use the enums above and are optional.
- A model estimate never accepts `temperature_band`; an estimate used for a hard temperature gate
  must be numeric.
- No free-text `conditions` field exists. User-visible copy is generated from structured values.

Keep schemas provider-portable: use properties, required arrays, enums, and numeric
minimum/maximum. Enforce cross-field rules (`high_f >= low_f`, range-or-band exclusivity, and at
least one meaningful user field) in shared runtime validators, not provider-specific `oneOf`.

### 4.2 Containing location/date is the binding

Neither weather object carries its own location or date. It is bound to the containing call or slot:

- plan-level weather applies only to slots inheriting the plan location and date range;
- a slot-specific date inside the plan range is compatible with the plan weather; a date outside
  that range is not;
- a slot with a different location or date supplies its own weather object or resolves live;
- slot-level structured weather overrides the corresponding plan-level input;
- weather from the home location, an earlier turn, or another slot never leaks into the current
  destination/date.

Use the existing normalized/geocoded location identity where available; do not compare display
strings literally (`Vienna VA` and `Vienna, Virginia` must not become different places). Date
compatibility is an inclusive ISO-date containment check. An omitted slot location/date inherits
the containing identity directly.

### 4.3 Model prompt contract

`STYLIST_SYSTEM` and every relevant tool description state:

- For a future named destination/date, provide a conservative numeric `weather_estimate` on the
  first composition/search call. The executor ignores fields replaced by live data.
- If the user explicitly states weather in the current message, translate only those stated fields
  into `user_weather`. Do not label the model's own seasonal knowledge as user weather.
- Use `environment`, never weather prose, for indoor/outdoor/coastal setting.
- Do not propose garments before reading the returned resolved weather, allowed roster, and
  submission requirements.
- Never call a model estimate a forecast.

The first-call estimate avoids an extra provider turn on the normal path. A typed missing-weather
stop still protects the system if the model omits it.

## 5. Canonical resolved object

### 5.1 Shape

All downstream consumers receive one `ResolvedWeatherContext`:

```js
{
  status: 'resolved',                 // 'resolved' | 'unavailable'
  location: 'Vienna, Virginia',
  dateRange: { start: '2026-10-12', end: '2026-10-18' },
  temperature: {
    highF: 65,
    lowF: 45,
    band: null,
    isHot: false,
    isCold: true,
    isExtremeHeat: false,
    source: 'model_estimate'
  },
  precipitation: {
    value: 'unknown',
    source: 'unavailable'
  },
  wind: {
    value: 'unknown',
    source: 'unavailable'
  },
  overallSource: 'model_estimate'
}
```

`overallSource` is derived, never accepted from a model:

```text
stated_user | live | model_estimate | mixed | unavailable
```

`mixed` means resolved fields came from more than one source. Each field retains its source, so
“the user said rainy” can coexist with live or estimated temperature without either fact erasing
the other.

Do not encode environment in provenance. Values such as `indoor_transit_model_estimate` are
removed; an indoor slot has `environment:'indoor'`, while its transit temperature keeps the
truthful source `model_estimate`.

### 5.2 Field-level precedence

Resolve each physical dimension independently:

```text
explicit structured user field
→ matching live field
→ matching structured model-estimate field
→ unavailable
```

Examples:

- User says “rainy,” live says 65/45: precipitation is `stated_user`; temperature is `live`.
- User says “45°F,” live is unavailable: temperature is `stated_user`; missing precipitation and
  wind may remain unavailable.
- User gives no weather, live is unavailable, model supplies 65/45: temperature is
  `model_estimate`.
- User says “cold,” live says 65/45: the qualitative `stated_user` temperature band wins; retain
  live numeric values only as non-authoritative diagnostics, not as the gate-driving range.

Temperature resolution is required for named-location/date composition. Precipitation and wind may
remain unavailable unless another existing hard rule specifically requires them.

### 5.3 Shared validators and classifier

Implement in `styling-engine/weather.js` and reuse everywhere:

- `validateUserWeather(input)`;
- `validateWeatherEstimate(input)`;
- `resolveWeatherContext({ userWeather, liveWeather, modelEstimate, location, dateRange })`;
- `classifyTemperatureRange({ highF, lowF }, { exclusive })`;
- `serializeResolvedWeatherContext(context)`;
- `restoreResolvedWeatherContext(stored)`.

The classifier uses the same constants and thresholds as live weather. Multi-day ranges are
non-exclusive: a 90°F high and 40°F low legitimately set both `isHot` and `isCold`. No consumer
re-parses numbers or condition words.

Qualitative user bands map deterministically:

| Band | isHot | isCold |
|---|---:|---:|
| `hot` | true | false |
| `cold` | false | true |
| `mild` | false | false |

## 6. Execution behavior

### 6.1 Resolve once, before retrieval

The central styling-context resolver owns weather resolution. `plan_outfit_set`,
`search_wardrobe`, `propose_outfit`, and `generate_outfits` call it before retrieving or
scoring pieces. `propose_outfit` reuses a prior resolved context only when its normalized location
and date identity exactly match the current request.

No tool rebuilds weather from `season`, `mood`, `question`, slot labels, card prose, or home
weather when a named destination/date is present.

At-home/current-season requests with no named location/date retain existing heuristic behavior as
a deliberate no-op. That heuristic result is tagged `heuristic` and cannot be persisted as the
weather for a named future trip.

### 6.2 Typed unresolved stop

If a named destination/date has no resolved temperature, stop before roster construction:

```json
{
  "status": "weather_context_required",
  "location": "Vienna, Virginia",
  "date_range": { "start": "2026-10-12", "end": "2026-10-18" },
  "missing": ["temperature"],
  "message": "Live weather does not cover these dates. Re-call this tool with weather_estimate.high_f and weather_estimate.low_f."
}
```

For a multi-slot plan, one unresolved required slot stops the entire plan. Use `.some()`, not an
all-slots check. The stop happens before `buildPlanSlotWorkbench`, `pendingPlan`, roster creation,
or any outfit submission.

### 6.3 Planner projection

Each slot workbench carries:

```js
{
  resolvedWeather,
  weatherUsed,
  submissionRequirements
}
```

`weatherUsed` is generated from structured data and truthful provenance:

```text
65°F high / 45°F low — seasonal estimate, not a live forecast
```

The allowed roster is produced through existing piece-trust/weather authorities using
`resolvedWeather.temperature`. The workbench and `submit_plan_outfits` validator consume the same
object instance or serialized equivalent; neither recomputes it.

### 6.4 Indoor transit

Do not erase outdoor temperature for indoor slots. Project it explicitly:

```js
{
  isIndoor: true,
  baseWeather: { isHot: false, isCold: false },
  transitWeather: resolvedWeather
}
```

For cold transit:

- an indoor base may remain light;
- each submitted card must include adequate removable, sleeve-bearing coverage;
- open-toe/open warm-weather footwear is rejected unless the user explicitly anchored that piece;
- use structured shoe fields and existing footwear helpers, never garment names;
- closed athletic sneakers remain valid;
- mild cold sets a minimum and does not force the heaviest coat.

This enforcement ships in the same implementation. It is not deferred.

### 6.5 Single-outfit parity

The same `user_weather` and `weather_estimate` schemas, validator, resolver, and persisted resolved
context apply to:

- `search_wardrobe` (`location`, `date`/`date_range`, both weather inputs);
- `propose_outfit` (`location`, `date`/`date_range`, both weather inputs);
- `generate_outfits` (`location`, `date`/`date_range`, both weather inputs).

Search stores its resolved context in `toolContext`; proposal consumes the matching context. An
initial multi-slot trip still belongs to `plan_outfit_set`. Schema parity does not authorize
`propose_outfit` to hand-build a trip one look at a time.

## 7. Continuity and observability

Every accepted card and `current_outfit_set` projection stores:

- serialized `ResolvedWeatherContext`;
- normalized location and date/date-range identity;
- user-visible `weather_used`.

Update both current projections:

- `boundedConversationStateFromToolContext` in `routes/ai.js`;
- `outfitSetFromBody` in `buildStylistConversationPayload` in `styling-engine/core.js`.

Persist accepted full-stylist plan state server-side in the successful tool path; do not wait for
the browser to echo cards on a later request. Follow-ups such as “what weather were you planning
for?” read the stored structured object and state whether values were live, user-stated, mixed, or
estimated.

Set `freeform_generation_runs.weather_source` from `overallSource`. Keep the user-visible plan
line as the primary disclosure. Diagnostics may additionally count estimate fallback and unresolved
stops, but diagnostics never substitute for disclosure.

## 8. Required code changes

### Remove

- `currentTurnStatedWeather` and its regex/constants/tests from
  `styling-engine/stylingIntent.js`;
- `statedUserWeatherProfile` from `styling-engine/weather.js`;
- `toolContext.currentTurnWeather` from `routes/ai.js`;
- `fallbackStatedUserWeather` / `slot.statedUserWeather` and related planner logic;
- free-text `weather` from the four composition tool schemas;
- every path that lets `question`, `mood`, `season`, `slot.weather`, or display text outrank
  live or structured weather for a named destination/date.

### Add or change

- shared input validators, field-level resolver, classifier, serializer, and restorer in
  `styling-engine/weather.js`;
- `user_weather` and `weather_estimate` schemas in all four tools and all provider projections;
- central pre-retrieval resolution and typed unresolved stop;
- planner cold-transit layer and footwear enforcement;
- matching-context reuse for search → propose;
- structured card/thread persistence and run diagnostics;
- prompt instructions and truthful generated labels.

Do not leave old and new authorities running side by side. A completed implementation has one
gate-driving weather path.

## 9. Permanent offline acceptance tests

All tests inject live-weather results. No unit/contract test calls a weather API or model.

### Contract and validation

1. Tool schemas for Anthropic, OpenAI, and Gemini expose identical `user_weather` and
   `weather_estimate` fields on all four composition tools.
2. Estimate 65/45 validates; missing endpoints, high below low, non-finite values, and out-of-range
   values fail.
3. User numeric range, single temperature, and qualitative band validate.
4. User range plus band, incomplete numeric range, empty object, and invalid enums fail.
5. Celsius exists only at the model-translation boundary; executor schemas accept Fahrenheit
   fields only.

### Resolution and provenance

6. User temperature overrides live temperature.
7. User rain plus live 65/45 produces mixed provenance without erasing temperature.
8. Live temperature overrides the model estimate.
9. Unavailable live weather falls back to the model estimate.
10. A 90/40 multi-day range is both hot and cold.
11. Unavailable live weather without estimate stays unavailable, never mild.
12. Plan weather inherits only to matching-location/date slots.
13. A different-location slot cannot inherit it.
14. No named location retains existing heuristic behavior as a ranking no-op.

### Anti-regression: prose is inert

15. `October 12`, `10 outfits`, `18°C`, `warm colors`, `cool outfit`, `winter white`,
    `icy blue`, and `crisp outdoor walking weather` cannot create or alter resolved weather.
16. A free-text `weather` HTTP field cannot alter roster membership or validation.
17. Numeric ranges are classified from structured endpoints, never extracted from strings.

### Roster, workbench, and validation

18. Vienna 65/45 outdoor rosters exclude existing cold-prohibited bare pieces before composition.
19. An outdoor sleeveless/bare look without adequate coverage is rejected.
20. An indoor museum base may be light, but its card is rejected without adequate cold-transit
    coverage.
21. Open platform sandals are rejected for 45°F cold transit.
22. Closed athletic sneakers remain allowed.
23. A shared valid layer may repeat under `reuse:'maximize'`.
24. One unresolved slot stops a mixed plan before roster or `pendingPlan` creation.

### Tool loop and continuity

25. The exact Vienna request reaches `plan_outfit_set` once with 65/45 estimate input, receives a
    cold-valid roster, and submits valid cards without a weather retry or outfit repair.
26. Equivalent provider fixtures follow the same call sequence and constraints.
27. `search_wardrobe` and `propose_outfit` use the same matching resolved context.
28. A mismatched location/date prevents context reuse.
29. Accepted cards preserve range plus field-level provenance into `current_outfit_set`.
30. A follow-up reports the exact 65/45 range and says it was a seasonal estimate.
31. Existing live-forecast, at-home heuristic, hot indoor-transit, cold-severity, and provider
    parity fixtures remain green.

The acceptance criterion is the first submitted outfit set. A test that passes only because
`submit_plan_outfits` repairs or retries a weather-invalid outfit does not satisfy item 25.

## 10. Straight-line implementation order

This is one complete change, not a phased roadmap:

1. Add shared types/validators/resolver/serialization in `styling-engine/weather.js` with unit
   tests.
2. Change all four tool schemas and provider parity tests.
3. Update `STYLIST_SYSTEM`; remove advertised free-text weather authority.
4. Remove the regex-based stated-user path completely.
5. Route all four tools through the central resolver before retrieval.
6. Add the all-slot precheck and typed unresolved result.
7. Feed the resolved object to roster construction, workbench copy, and validators.
8. Complete indoor-transit layer and structured footwear enforcement.
9. Persist serialized context into cards, thread state, and diagnostics.
10. Add the exact tool-loop and continuity acceptance fixtures.
11. Amend load-bearing docs inline and dated:
    `docs/engine-behaviour-map.md`, `docs/freeform-rearchitecture-handoff.md`, and
    `docs/flows/freeform-stylist-chat.md`.
12. Run `npm test`. Do not merge with a newly introduced failure or a weakened ratchet.

No paid live verification belongs inside the implementation test suite. After all offline tests
pass, print the estimated cost and obtain explicit owner confirmation before running the exact
Vienna request once against the configured production provider. Success requires the initial roster
and first submitted cards to be weather-valid; downstream repair is recorded as failure for this
verification.
