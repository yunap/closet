# Findings — stated weather silently loses to live weather

**Status:** Diagnosed 2026-09-01; options 1 and 3 implemented the same day on owner instruction — see §8.
**Route:** [docs/README.md](README.md). Companion to
[future-trip-weather-estimate-spec.md](future-trip-weather-estimate-spec.md) (PR #284), whose
§3.1 boundary this finding deliberately does not cross without a decision.

## 1. The symptom

Three times across live QA, the owner stated a temperature and the engine composed against a
different one. In each case the failure was invisible: the reply reads as ordinary model judgment,
and nothing surfaces that the weather used was not the weather asked for.

| Turn | Stated | Weather provenance actually resolved |
|---|---|---|
| Visual Composer: *"chilly evening, about 55°F, dinner nearby"* | 55°F, chilly | `live` — 68.9°F/57.6°F, **not cold at all** |
| `/ask`: *"38°F and I'm walking around the city all afternoon"* | 38°F | `named_destination.stated_user` ✅ |
| `/ask`: *"38°F outside but I'm at a museum indoors all day"* | 38°F | `named_destination.stated_user` ✅ |
| `/ask`: *"42°F and raining, I'll be walking a lot"* | 42°F, rain | `named_destination.stated_user` ✅ |
| `/ask`: *"If it's 38°F and raining and I'll be walking for hours, what am I missing?"* | 38°F, rain | `live` — mild and dry |

The last row is the one that exposed the mechanism. It produced an outfit wearing mesh athletic
sneakers on a "38°F and raining" request — which looked like the brand-new mesh footwear gate
failing. It was not. Fed the same piece and a 38°F/wet profile directly, the gate returns:

```text
{"allowed": false, "reasons": ["severe cold: ventilated/mesh footwear",
                               "wet exposure: absorbent footwear material"]}
```

`propose_outfit` enforces that verdict and returns `validation_error` on any failed piece. The gate
was correct and armed. It simply never saw cold or rain.

## 2. What is NOT broken

Worth stating, because each was suspected first and cleared:

* **Resolver precedence is correct.** `resolveWeather` in `styling-engine/stylingContext.js` puts
  explicit structured weather above named-destination live lookup, which is above prose and saved
  snapshots. It behaved to spec on all five turns.
* **The per-piece gates are correct**, including the new mesh rules.
* **`propose_outfit` does gate** its model-chosen pieces through
  `evaluateAutomaticUsePiecePool`, and rejects with a typed `validation_error`.
* **The carry-forward is working as designed** — which is part of the problem, see §4.

## 3. The mechanism

PR #284 made a deliberate architectural choice, and it is the right one:

> **§3.1 No prose-to-weather authority.** *"Delete `currentTurnStatedWeather` and
> `statedUserWeatherProfile`… Do not replace them with another regex, keyword list, NLP helper, or
> call to `extractWeatherContext`."*

The rationale is sound and hard-won: the previous prose-scanning repair turned dates, outfit counts,
Celsius values and phrases like *"warm colors"* into parser edge cases. So the contract moved the
translation step to the model:

> **§4.3** *"If the user explicitly states weather in the current message, translate only those
> stated fields into `user_weather`."*

That contract has a stated safety net:

> **§4.3** *"A typed missing-weather stop still protects the system if the model omits it."*

**The safety net only covers absence, not substitution.** `weatherContextRequiredStop`
(`styling-engine/tools.js:493`) is one condition:

```js
if (!resolved || resolved.status !== 'unavailable' || !resolved.location) return null
```

It fires only when live weather came back **unavailable**. For an at-home request with a configured
weather location, live weather essentially always resolves — so the net never fires, and a model
that failed to translate the user's stated weather has its omission silently filled by a plausible,
authoritative-looking, wrong number.

Restated as the invariant that is missing:

```text
covered      user states weather, model omits it, live unavailable   → typed stop, model re-called
NOT COVERED  user states weather, model omits it, live available     → live silently substitutes
```

## 4. Why the blast radius is large

* **It disables every weather gate at once.** Cold severity, outerwear capability, the wet/cold
  footwear rules, Contract C's outfit adequacy — all of them read the resolved profile. A wrong
  profile disarms the lot in a single step, silently.
* **The carry-forward multiplies it.** PR #284 caches the first resolution on
  `toolContext.weatherProfile` and reuses it for the rest of the turn. One bad first tool call
  poisons every later call in that turn — including a `propose_outfit` that happens after the model
  changes its mind and composes anyway.
* **It disguises itself as model misbehaviour.** The observed symptom was "the stylist put mesh
  sneakers on in the rain," which reads as a bad recommendation or a missing gate. Three
  investigations landed on the wrong suspect before the provenance field settled it.
* **It is more likely on questions than on requests.** All three correct turns were direct build
  requests. Both failures came from turns where the user asked something conversational — where the
  model has less reason to reach for a composition tool argument.

## 5. Two surfaces, two different gaps

The `/ask` and Visual Composer failures share a symptom but not a cause, and a fix for one does
nothing for the other.

**`/ask`** — the structured path exists (`user_weather`) and the model failed to use it. This is a
compliance gap with a dead safety net.

**Visual Composer** — there is no structured weather input at all. The brief form sends
`{ occasion, season, mood, request, question, mission, limit, activity }`. The only weather control
is the Season dropdown (`Current season / Spring / Summer / Fall / Winter / Very hot weather / Very
cold weather`); a temperature typed into **Mood** or **Styling request** reaches only
`weatherProfileFromContext`, whose heuristic profile ranks *below* live weather. So on this surface
the user has **no way to state a temperature that wins** — "very cold weather" is the strongest
available statement, and it cannot say 38 rather than 20.

## 6. Owner ruling required

Every candidate fix brushes against §3.1, so none should be built without a decision.

**The distinction that matters:** §3.1 forbids prose from *populating* weather —
`user_weather`, `ResolvedWeatherContext`, or any gate. A detector that only *refuses to proceed* and
asks the model to translate populates nothing; it is a compliance check, not an authority. Whether
that is inside or outside the boundary is the ruling.

1. **Extend the stop to substitution (recommended).** When the request text carries an explicit
   weather signal and no `user_weather`/`weather_estimate` was supplied, return the existing typed
   `weather_context_required` stop instead of proceeding on live. The detector never sets a value —
   it forces the model to. Cost: one extra tool iteration on affected turns, and a detector whose
   false positives cost a bounce (a false negative just restores today's behaviour).
2. **Tool-description strengthening only.** Cheapest, no boundary question, and weakest — the model
   already has this instruction and did not follow it on two of five turns.
3. **Give the Visual Composer a real weather input.** Independent of 1 and 2; the only fix for §5's
   second surface. A numeric high/low pair on the brief form, resolving as `user_weather` does.
4. **Do nothing.** Accept that stated weather is advisory unless the model cooperates. Worth stating
   explicitly so it is a decision rather than a default.

Options 1 and 3 are complementary and address different surfaces.

## 7. Reproduction

Not yet reduced to an offline fixture — the failure needs a live provider turn where the model
declines to pass `user_weather`. A deterministic proxy exists: call `resolveStylingContext` with a
`requestText` containing weather, no `userWeather`, an available live resolver, and assert the
resolved provenance is `live` while the text says otherwise. That test would encode the current
(intended) behaviour, so it belongs with whichever option above is chosen, not before it.


---

## 8. Implementation (2026-09-01)

Owner chose the recommendation: options 1 and 3, which fix different surfaces.

### Option 1 — the stop now covers substitution

`weatherContextRequiredStop` gains a branch that fires when the request text states weather, the
call carried no `user_weather`/`weather_estimate`, and the resolved profile did not already come
from a stated source. It returns the existing typed `weather_context_required` status, so the model
re-calls with the translation §4.3 already asks it for.

**Why this stays inside §3.1.** The detector sets nothing. It cannot populate `user_weather`,
`ResolvedWeatherContext`, or any gate — it can only refuse to proceed. A false positive costs one
bounce; a false negative restores the previous behaviour.

Deliberately narrow: a number with a temperature unit, or an unambiguous precipitation noun. **Not**
bare adjectives — `warm`, `cool`, `hot`, `chilly` collide with style prose (*"warm colors"*, *"cool
tones"*, *"hot pink"*) and are the exact false-positive class §3.1 was written about. `snow` is
excluded when it names a garment (*"snow boots"*). The accepted consequence is a false negative:
*"chilly evening"* is real weather and is not detected.

The carry-forward exemption reads the **profile's own** `weatherSource`/`overallSource`, not the
resolution branch — a carried profile reports `explicit_request.weather_profile` whether it
originated from stated weather or from live, so exempting on the branch would have reopened the gap.

### Option 3 — the Visual Composer gets a structured weather input

An optional high/low °F pair on the brief form, sent as `userWeather` and resolved through the same
typed contract `/ask` uses. Empty means unstated and the composer behaves exactly as before.
Transposed entries are normalized rather than rejected, since `validateUserWeather` requires
`high >= low` and would otherwise silently drop the pair and use the forecast.

### A third bug this surfaced

The option-3 test — *"a structured userWeather range beats an available live forecast"* — passed on
`isCold` and failed on `isColdSevere`. Cause: `profileFromResolvedWeatherContext`
(`styling-engine/stylingContext.js`) dropped severity.

That projection is the one **every structured-weather path** uses: `user_weather`,
`weather_estimate`, and named-destination live. So no `/ask` or composer turn resolving structured
weather has ever carried `isColdSevere` — meaning Contract C's severe-cold branch and the new mesh
cold rule could not fire on those turns at all.

Same silent-loss shape as the consolidation spec's `[R1]`, in a third place: severity was propagated
into `resolveTemperatureField`, into the persisted shape, and into the planner's slot profiles, but
not through this projection. Fixed, with `transitIsColdSevere` carried through the indoor projection
to match the planner.

It also revises the earlier live-QA read: the three `/ask` turns that resolved
`named_destination.stated_user` and produced correct outfits did so on the mild-cold floor and model
judgment, **not** on the severe-cold branch, which was inert throughout.

### Tests

`test/statedWeatherComplianceStop.test.js` (6) pins the detector, including the whole
false-positive class and the deliberate false negatives. `test/composerStatedWeather.test.js` (4)
pins that prose still loses, that structured weather wins over an available live forecast, that a
mild range does not manufacture cold, and that no input leaves behaviour unchanged.

Three fixtures gained an outer layer — not by weakening assertions, but because severity now
actually reaches consumers and an outfit with no layer at a 40°F low legitimately fails. Each is
annotated in place.
