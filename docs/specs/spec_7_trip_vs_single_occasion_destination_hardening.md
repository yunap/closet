# Spec 7: "Vague trip" vs. "single occasion elsewhere" — destination/weather clarification still asks when it shouldn't

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


**Status:** Ready for implementation. Confirmed live (2026-07-09), second occurrence of the same bug class spec 4's prompt fix was meant to close.
**Priority:** High — same user-facing symptom as the bug spec 4 fixed (the app asks a clarifying question it has enough information to skip), now confirmed to recur on a different phrasing, meaning the prompt-only fix isn't reliable enough alone.
**Files touched:** `styling-engine/prompts.js` (`STYLIST_SYSTEM` — sharpen the trip-vs-occasion distinction), `styling-engine/provider.js` (`askStylistWithTools` — new mechanical retry, same architecture as spec 3 Part 0b), tests.

---

## Finding

Live repro: *"I'm going to Napa on Saturday. What should I wear to a winery lunch?"* → *"What weather are you expecting for the Napa trip on Saturday? This will help me recommend the most suitable outfit for the winery lunch."*

Traced precisely (not guessed): the message contains "going to", matching `isTravelOrPackingRequest`'s regex ([stylingIntent.js:58-61](../styling-engine/stylingIntent.js:58)), so `isTravelPlanning = true` in `maybePrecomposeStructuredOutfitsForAsk`. Since the message has no explicit weather words, `extractedWeather` is empty, so `if (isTravelPlanning && !extractedWeather) return null` ([routes/ai.js:1199](../routes/ai.js:1199)) — the server-side trip-precompose heuristic bails out and hands the turn to the model. The user's own console logs show **zero tool calls** for this turn — confirming the model produced the clarifying question without ever attempting `search_wardrobe`, with or without `location`.

**Root cause (user's own diagnosis, confirmed correct): the model is conflating two shapes of request that `STYLIST_SYSTEM`'s existing examples don't clearly distinguish:**
1. **Vague packing/trip request** — "I am planning a trip and need packing outfits" (Example 1 in `STYLIST_SYSTEM`) — genuinely has neither a specific occasion nor enough context; asking is correct.
2. **A specific single occasion that happens to be elsewhere** — "winery lunch in Napa," "museum visit in San Francisco" (Example 1b, added in spec 4) — already has both an occasion *and* a place; asking is wrong, `location` should be passed and the turn should proceed.

"Going to Napa" superficially resembles case 1's travel language, but the request is actually case 2 (a single named occasion, a single day, a single place) — the model pattern-matched on the travel-flavored phrasing rather than the concrete occasion+place already present. Spec 4's Example 1b used a *museum* framing; this repro shows the model doesn't reliably generalize that distinction to different phrasing ("winery lunch," "trip," "on Saturday"). This confirms prompt guidance alone isn't sufficient — the same lesson spec 3 Part 0 already established for the zero-result hallucination bug.

## Part 1 — Sharpen the trip-vs-occasion distinction in `STYLIST_SYSTEM`

Extend the "Destination & Weather Clarification" rule (the one spec 4 already touched) with an explicit distinguishing test, not just another example:
```
The distinguishing question: does the request already name a SPECIFIC occasion/event (a lunch, dinner, museum visit, hike, wedding, concert, etc.) and a place — even one word? If yes, this is never the vague-packing case, regardless of travel-flavored phrasing like "going to," "trip," or a day-of-week — extract the place, pass it as `location`, and proceed. Only the genuinely open-ended case — no occasion stated, just "I'm going on a trip" / "help me pack" — should trigger the clarifying question.
```
Add a second example alongside Example 1b showing this exact repro (occasion + place + travel-flavored wording, still proceed):
```
* Example 1c (Travel-flavored wording, still a single specific occasion — do not ask):
  User: "I'm going to Napa on Saturday. What should I wear to a winery lunch?"
  Assistant calls 'search_wardrobe' with `location: "Napa"` (live weather resolves automatically) and proceeds straight to proposing — "going to Napa" and "trip"-adjacent phrasing does not make this the vague-packing case; a winery lunch is a specific named occasion.
```

## Part 2 — Mechanical backstop: retry if the model asks without ever searching (mirrors spec 3 Part 0b exactly)

Prompt sharpening alone isn't trustworthy enough on its own (this is the second miss). Add a mechanical check in `askStylistWithTools`, at the same two return points spec 3 Part 0 already instrumented:

```js
// After computing `finalText` and running the existing zero-result-contradiction check:
if ((toolContext?.freeformDiagnostics?.searchCalls || 0) === 0 && looksLikeDestinationOrWeatherQuestion(finalText) && !destinationClarificationRetried) {
  destinationClarificationRetried = true
  currentMessages.push({ role: 'assistant', content: finalText })
  currentMessages.push({ role: 'user', content: "You asked about weather or destination without calling search_wardrobe first. If this message names any real place or specific occasion (even one word — a city, region, venue, or event), call search_wardrobe with that as `location` and proceed to propose an outfit. Only ask again if you genuinely cannot identify any destination or occasion in the request." })
  continue
}
```
New helper `looksLikeDestinationOrWeatherQuestion(text)` in `provider.js`, alongside the existing `findZeroResultContradiction`/`looksLikeUnproposedOutfitProse`: a regex/keyword check for a question mark plus phrasing like "what weather," "what destination," "where are you going/headed," "what's the weather." Deliberately loose (a few false positives just cost one harmless retry — same risk profile as spec 3's 0a soft flag, but this one is a forced retry since the cost of the miss is a full extra clarifying turn from the user's perspective).

**Why gate on `searchCalls === 0` specifically, not just the question pattern:** if the model already tried `search_wardrobe` (e.g., a genuine ambiguous case where it searched, got nothing useful, and asked a legitimate follow-up), this shouldn't force a retry — only the "asked without even trying" case is the confirmed failure mode.

New diagnostic counter `toolContext.freeformDiagnostics.destinationClarificationRetries`, following spec 3's existing pattern (surfaced in the collapsed "ⓘ Search & validation details" affordance and logged to `freeform_generation_runs` — one more column, same migration pattern as spec 3 Part 0's two).

## Tests

1. `STYLIST_SYSTEM` includes the new distinguishing-question language and Example 1c (prompt-string assertions, same convention as spec 4's Example 1b tests).
2. `looksLikeDestinationOrWeatherQuestion` unit tests: matches "What weather are you expecting for the Napa trip on Saturday?" (the literal repro); does not match ordinary proposing prose with no question about weather/destination.
3. **Known test gap, disclosed up front (same as spec 3 Part 0b):** the retry logic itself lives inside `askStylistWithTools`'s tool-calling loop, which is bypassed entirely under `NODE_ENV=test` (`takeTestAiResponse` short-circuits before reaching it). Only the pure helper function gets a unit test; the actual retry-in-the-live-loop needs live verification — re-test the exact "Napa winery lunch" phrasing and confirm no clarifying question reaches the user.
4. Full existing suite green.

## Out of scope

- Any change to `isTravelOrPackingRequest`/`maybePrecomposeStructuredOutfitsForAsk`'s own bail-out condition (`isTravelPlanning && !extractedWeather`) — that heuristic correctly hands off to the model in this case; the model's own decision once it has the turn is what's broken, not the server-side routing.
- Spec 4's live-weather module itself (`weather.js`) — unaffected, already correct; this is entirely about whether the model calls it.
