# One stylist per thread

**Status:** active — built and live-checked 2026-11-11 on `feat/one-stylist-per-thread` (owner: "build it").
Verdict: keep (see "Live check"). Keep-or-revert follows the check-set run described under "Build". The design below is as
proposed; what was built, and what moved where, is in "As built".

## The question

The owner's question was: is "a one-shot request plus memory the app builds" the best way to give a
user a continuous conversation with a stylist?

- **Across days and weeks, the answer is yes.** Rebuilding each turn from stored memory is right for a
  conversation spread over weeks. What would make it better is what goes into that memory; that is a
  separate piece of work (see "Not in this proposal").
- **Within a sitting or a day, the answer is no.** A conversation is a sequence of turns that each start
  over, often on a different path. This proposal is about that case.

## How a typed turn works today

A turn starts over every time:

1. **Client dispatch.** `send()` in `StylistChat.jsx` picks an endpoint. Typed chat goes to
   `/api/ai/ask`; critique and launched-piece follow-ups go to their own endpoints.
2. **The router chooses a path.** `routeFreeformExecutionProfile` (`gemini-3.7-flash`, low thinking)
   picks one of eight profiles. Each profile has its own prompt and model calls:

   | Profile | What answers | Prompt |
   |---|---|---|
   | `full_stylist` | tool loop | `STYLIST_SYSTEM` (~48,500 chars) + manifest + 14 tools |
   | `single_outfit` | tool loop, 3 tools | `SINGLE_OUTFIT_STYLIST_SYSTEM` (~10,400 chars) |
   | `bounded_multi` | the whole-wardrobe visual composer, with photos | `WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM` (~17,300 chars) |
   | `trip_plan` | lean tool loop (`plan_outfit_set`) | `STYLIST_SYSTEM`, no manifest |
   | `existing_card_explanation`, `garment_fact`, `general_advice`, `wardrobe_inventory` | one compact call, or code | `compactFreeformAnswerSystem` |

3. **She rebuilds the conversation.** Whichever stylist answers gets the following, rebuilt for that one
   turn:
   - The last 8 messages, 12,000 characters at most, text only (`boundFreeformConversationHistory`).
   - The thread's stored state (`stylist_conversation_state`): established context, the current card
     set and the packing roster.
   - Memory and feedback.
4. **Her working is lost at the end of the turn.** That means the garments she looked up, the photos she
   compared, and the options she weighed and dropped. Only the cards, their reasons and the stored state
   carry on.

Measured from these sources:

- **The live check of 2026-11-11** (`gemini-3.5-flash-lite`; `ai_call_log` on a copy of the owner's
  data):
  - Every turn's first stylist call was ~40,000 input tokens with **nothing cached**.
  - Later calls in the same turn continue the Gemini interaction and were 50–70% cached.
  - A turn cost 1.5–5.7¢.
- **[freeform-prompt-cache-levers.md](freeform-prompt-cache-levers.md)** (2026-10-07): Gemini's implicit
  cache does hit across turns when they are minutes apart ($0.017 cold, $0.0035–0.0048 warm). It needs
  the next request to start with the same bytes, and a change of profile changes them.

## What goes wrong because of it

- **Each follow-up can be a different stylist.**
  - The first cards may come from the options composer, and "swap the cardigan" from the full stylist.
    Each has a different prompt and different evidence.
  - "More like the second one" then has to be rebuilt from a stored card summary, by a stylist who never
    saw why the card was built.
- **Her own words can drop out.**
  - Live `thread_1791423893034`: the Gemini adapter dropped her earlier replies from the rebuilt history,
    and she planned the trip again. The fix and its history are in the comment above the adapter's
    history projection in `provider.js` (2026-10-07).
  - A rebuilt history is one more place for that class of fault to live.
- **She fills gaps.**
  - Live check case F (2026-11-11): the conversation the user meant was not in front of her, and she
    answered as if she remembered the objection.
  - Answering from summaries invites exactly this.
- **A long sitting loses its beginning.** Past 8 messages, what the user said early ("I'm cooking",
  "nothing too warm") survives only if it landed in one of the stored state's fields.

## The proposal

**One stylist owns a thread. Within the provider's retention window, each turn continues the same
conversation instead of rebuilding it.**

### The transport

- **Gemini.** The Interactions API is stateful server-side. The adapter already chains
  `previous_interaction_id` within a turn (`provider.js`). The change is to keep chaining across turns:
  - Store the thread's last interaction id in its state.
  - Send only the new user message and what changed.
- **No new caching mechanism.** Google's docs (read 2026-11-11):
  - Implicit caching is on by default for "all Gemini 2.5 and newer models", in both stateful and
    stateless modes, and continuing an interaction "allows the system to more easily utilize implicit
    caching for the conversation history".
  - Explicit caching is not available in the Interactions API, and is not needed here.
  - Gemini 3.7 Flash is not in the minimum-size table (its neighbours need 4,096 tokens). Our turns are
    20,000–46,000 tokens.
- **Retention.** Google keeps stored interactions for **55 days on the paid tier** (adjustable to 7, 14
  or 28) and **1 day on the free tier**.
- **Anthropic** keeps no conversation state. The same transcript is resent with cache breakpoints, and
  the 1-hour stable-prefix breakpoint already exists (`systemToAnthropicBlocks`).

### What stays the same

- **The engines stay, as tools she calls.** These are `propose_outfit`, `generate_outfits` (the visual
  composer, with photos), `plan_outfit_set` and `suggest_slot_swaps`. Composition keeps seeing photos:
  the visual-grounding lesson is not touched.
- **Hard gates stay in the tools**, as now: register, season, weather physics, owner constraints,
  verification.
- **The output contract** (`applyFreeformOutputChecks`) stays.

### What changes

1. **The per-turn context moves into each turn's message.** A continued interaction does not resend the
   system prompt (`provider.js` already omits `system_instruction` on a continuation). That context
   is:
   - Today's date.
   - The thread state.
   - Open plans.
   - The feedback that applies to this turn.

   The stable prefix is set once per conversation: constitution, profiles, manifest and tools.
2. **The router's structured reads move into `declare_intent`.** The router does more than pick a path.
   Its `setting`, `time_of_day`, `occasion`, `activity` and `clarifying_question` feed gates and weather
   resolution (engine map item 85: `not_stated`, `indoor_only`). These are reads of the user's own words
   that must survive. In this design the stylist declares them in her first tool call of the turn, and
   the same code consumes them.

   The router itself goes in the target (decision 1).
3. **Asking becomes one mechanism.** Today there are two:
   - The router writes the clarifying question on the single-outfit, options and trip paths, and the
     answer is stitched back in as "You asked me: … My answer: …".
   - The full stylist asks from her own prompt.

   An owner ruling (2026-10-06) says she must ask when information is missing or approaches differ.
   With one stylist, asking is her ordinary reply, and the answer arrives in the same conversation.
4. **The conversation is rebuilt when it cannot be continued.** Rebuilding means today's path: stored
   state, the recent messages, and memory. It happens when:
   - Retention has expired, or a continuation call fails.
   - The wardrobe manifest changed (a piece added, edited or retired), so the stable prefix is no longer
     true.
   - The model, provider or prompt version changed, including "Retry with Sonnet".
   - The conversation passed the size limit (decision 3).
   - The last turn was more than 7 days ago (decision 4).

   Each rebuild is recorded, so how often it happens is a query, not a guess.

## Cost

These are estimates from measured parts, not runs.

- **Today.** Each turn pays a cold first call of ~40,000 tokens, plus its tool calls.
- **Continued.** A turn reads the previous transcript at the cached rate:
  - Flash-Lite: $0.03 per million tokens, against $0.30 uncached.
  - 3.7 Flash: $0.075, against $0.75.
- **Growth.** If a turn adds ~20,000–30,000 new tokens (tool results and photos), a 15-turn sitting on
  Flash-Lite reads ~3.5 million cached tokens in total (~10¢) and ~0.4 million new ones (~12¢), plus
  output. That is about the same as today's 15 turns at ~3.5¢. On 3.7 Flash, multiply by about 2.5.
- **The unknown is photos.** `search_wardrobe` can attach up to 16 images per category. Every image
  stays in a continued interaction and is reread, cached, on every later turn. Anthropic can clear old
  tool results (context editing); whether a Gemini interaction can is not known. Measure this before
  setting the size limit (measured in the verification run under "Build").

The cost case is "about the same, with the whole sitting in view". It is not a saving. The repo's
closed OpenAI investigation ([freeform-openai-persistent-conversation-investigation.md](freeform-openai-persistent-conversation-investigation.md))
found that provider-side state saves nothing over caching. That stands: this proposal is about what she
can see, not what it costs.

## What we trade away

- **Each turn's prompt can no longer be built fresh.** Today a fix to the prompt applies on the next
  turn. A continued conversation keeps its original stable prefix until it is rebuilt, so a prompt
  change has to rebuild open conversations (change 4).
- **Determinism per path.** Some fixed paths go. The router's compact answers and `single_outfit` give
  predictable one-call answers today. Their rules become her judgment inside one prompt:
  - one outfit for an ordinary "what should I wear?";
  - answer from the cards for a "why".

  The 2026-10-06 ruling already says reply shape is hers.
- **Model dependence.** Flash-Lite missed two judgment calls in the 2026-11-11 live check (an open plan
  ignored, a memory claimed). A long, continuous conversation leans on the model more than a short
  rebuilt one does. That is the owner's standing condition: no expensive-model testing until the model
  is shown to be the bottleneck. This design is how to find out.

## Build (one change, then verify)

Owner, 2026-11-11: the app is not in production, so there is no staged migration. The change replaces the
old path; if the check set shows it is worse, the commit is reverted. There are no flags, no shadow router
and no traffic criteria.

**What gets built:**
- **Every typed `/ask` turn goes to the one stylist.**
  - The execution router and the per-turn profile choice are removed: `single_outfit`, `bounded_multi`
    as a route, the compact answers, and the lean `trip_plan` turn as a route.
  - The visual composer (`generate_outfits`) and `plan_outfit_set` stay as tools she calls.
- **`declare_intent` gains the router's structured reads:** `setting`, `time_of_day`, `occasion`,
  `activity` and a clarifying question. The code that consumed them from the router consumes them from
  her declaration instead, with the same gates.
- **The Gemini interaction continues across turns.**
  - The thread state stores the last interaction id, with the model, prompt version and manifest version
    it was built on.
  - Each turn sends only the new user message plus the per-turn context (date, thread state, open plans,
    applicable feedback).
- **Rebuild rules** (change 4, decisions 3 and 4). Each rebuild records its reason.

**Then verify:**
1. **Offline.** The suite stays green; the tests that pin today's routes are rewritten to the new
   contract, not deleted.
2. **Live.** Run the check set ([stylist-check-set.md](stylist-check-set.md)) and the cross-thread live
   set, including follow-ups in the same thread, on the app's own stylist model. The model and cost are
   named and approved before the paid run. Score as before, from captures.
3. **Measure from the same run**, so no separate measuring step is needed:
   - latency against input size;
   - photos per turn;
   - cached share;
   - time to answer on questions that need no tools.

   These set the size limit (decision 3) and check decision 2.

**Keep or revert:** keep if the check-set answers are at least as good and quick answers are not slower
than today's ~7 s; otherwise revert the commit.

## As built (2026-11-11)

**`/ask`** (`routes/ai.js`).
- The execution-router call and every routed branch are gone: single outfit, bounded options shortcut,
  compact answers, wardrobe inventory, router-written clarifying question, and the lean trip turn. Every
  typed turn builds the full stylist payload.
- `toolContext.freshExecutionRequest` keeps the structural freshness test.
- `requireDeclaredReading` and `continueThread` are set.
- The usual packing approach is passed into the payload.

**The reading** (`declare_intent`, `applyDeclaredTurnReading` in `tools.js`).
- New fields: `setting` (required), `occasion`, `activity`, `season`, `date`, `time_of_day`, `replan`
  and `remember_packing_approach`, carrying the router's own definitions.
- It sets the same `toolContext` fields the router set (`executionRouterIndoorOnly`,
  `…IndoorDestination`, `…NoSituation`, `…TimeOfDay`, the activity and season locks), read by
  `resolveToolStylingContext` as before.
- A fresh request locks occasion, activity and season. A follow-up takes a named season or activity only.
- The last declaration wins.
- On `/ask`, `search_wardrobe` and `generate_outfits` refuse without a declared setting.

**Moved with the router's retirement, so no ruling is lost:**
- **"A few options" is three** (engine map item 107). It is now in the `generate_outfits` description, its
  default count, `declareBoundedMultiLookIntent`, and the per-turn controller.
- **The trip packing question.** It is now in `plan_outfit_set`'s `packing_approach` description, and the
  usual approach on record is a per-turn line.
- **No whole-trip replan on a trip follow-up** (`thread_1791423893034`). `plan_outfit_set` is offered, but
  refuses without `declare_intent` `replan:true`.
- **The bounded exception in the controller.** It now declares the reading first, and states that an
  ordinary "what should I wear?" is one outfit.

**Continuation** (`provider.js`).
- `stylistContinuationDecision` decides from these: provider Gemini, same model, same
  `stablePromptFingerprint` (the text before `PROMPT_CACHE_BREAKPOINT`), last turn within 7 days, last
  input under 150,000 tokens.
- When it continues, `askStylistWithTools` chains the stored interaction id, sends only the new user
  message, and prefixes it with `withTurnContext` (the volatile half of the system prompt).
- If the continued call fails, it rebuilds once in the same turn. A billing failure is not retried.
- Each call records `toolContext.stylistContinuationState`. `persistFullStylistTurnState` stores it as
  thread state `stylist_continuation`, with `last_turn_at`, or removes it after a turn on another
  provider. The catch block clears it.
- `freeformDiagnostics.stylistContinuation` records the reason on every turn.

**Not changed:**
- Anthropic and OpenAI rebuild every turn, as before.
- Other callers of `askStylistWithTools` (outfit-evaluation follow-ups) do not opt in.
- A turn answered locally (the explicit-prohibition fast path) is not added to the provider conversation.
  Its rule is saved to memory, which the next turn's context carries.

**Retired code deleted (2026-11-11, after the keep verdict).** About 2,700 lines:
- **The execution router:** `routeFreeformExecutionProfile`, its prompt, schema and model settings.
- **The compact answer profiles and their helpers:** `compactFreeformContext`, `compactFreeformAnswerSystem`,
  `compactGarmentVisualEvidence`, the referent resolvers, and others.
- **The single-outfit route:**
  - `buildSingleOutfitConversationPayload` and `SINGLE_OUTFIT_STYLIST_SYSTEM`;
  - `declareSingleOutfitIntent`;
  - the single-outfit catalog mode in `search_wardrobe`, `view_pieces` and `propose_outfit`;
  - the single-outfit stop in the tool loop.
- **The router-written clarification hand-off:** `takePendingClarification` and `clarifiedRequestText`.
- **Core's branches for routes that no longer exist:** the lean trip-plan turn and answer-in-words.
- Tests of the deleted code went with it. Shared helpers and invariant tests were kept, with the retired
  prompt left out (the byte-for-byte prompt-equivalence ratchet skips `SINGLE_OUTFIT_STYLIST_SYSTEM`; its
  frozen snapshot stays).

**Three gaps found while deleting, fixed in the same commit:**
1. **Travel detection fell back to a word match.** Without the router's verdict, core decided "is this a
   trip" by matching words, which is the 2026-11-09 fault: guests at home with "we're going to a winery
   tasting" told to ask for the forecast (`thread_1794273948027`). The TRAVEL WEATHER BLOCKER now fires
   only when the picked occasion is `travel`. A trip described in words is the stylist's to read, and
   her tools return `weather_context_required` when they cannot look the weather up.
2. **`readTheSituation` reached only the options composer.** The single-outfit stylist carried it. The
   full stylist now has it in its stable prompt: read the room, say how you read it, do not ask what
   others wear.
3. **`HOW_A_DAY_AWAY_WORKS` reached the trip follow-up but not a fresh trip.** The lean trip-plan turn
   carried it. The full stylist's wardrobe instructions now give it before `plan_outfit_set`.

**Tests.**
- Removed with their paths: `test/bounded_multi_context_continuity_e2e.test.js`, and eight route-shape tests
  in `freeform_observability` and `aiEndpointContracts`.
- Re-pointed to `declare_intent`: the occasion/activity/season lock, the indoor-destination setting, answer
  in words, and the trip replan guard.
- New: `test/one_stylist_per_thread.test.js`.

## Live check (2026-11-11)

**How it was run.**
- 15 turns through the real `/api/ai/ask`, on a copy of the owner's data (the live data was never opened).
  The script is `scratch/run_one_stylist_live_set.mjs`, untracked, with `--dry-run`.
- Models: stylist `gemini-3.5-flash-lite` (the app default), composers `gemini-3.7-flash`.
- Turns: the seven check-set entries as typed; follow-ups in the same thread on entries 2, 3, 5 and 7; the
  cross-thread cases A, C, D and F.
- Cost: $0.78 for the 15 turns, then $0.27 to rerun entries 2, 3 and 7 after two fixes. That is $1.05
  against the $1.13 approved.
- Per-entry scores are in [stylist-check-set.md](stylist-check-set.md).

**Fixed during the check** (commit "fingerprint the marked prompt; a declared season is a season name
only"):
1. **No follow-up was continued.** All four rebuilt with `stable_prompt_changed`. The loop fingerprinted
   the prompt after the breakpoint marker had been stripped, and the captures showed the stable halves
   byte-identical between turns.
2. **The stylist declared `season: "cool"` on most turns.** Locked as-is, it matched no season rule, and
   out-of-season pieces came back: linen trousers on November evenings in 4.1 and 7.1. "warm" would
   have locked as summer. Now only a season's own name is taken, and the field is an enum.

**Continuation, after the fix.** Every follow-up on the rerun continued.

| Follow-up | Rebuilt (first run) | Continued (rerun) |
|---|---|---|
| 2.2 "a little warmer" | 14 s, 3.1¢ | 8 s, 1.1¢ |
| 7.2 "why that jacket?" | 7 s, 2.6¢ | 4 s, 0.9¢, one call, no tools |
| 3.2 "Really? jeans?" | 27 s, 4.7¢ | 38 s, 6.8¢ |

- In 3.2, turn 1's searched photographs stay in the conversation: the first call read 95,000 tokens, 96%
  cached, at 7.9 s against ~5 s for a cold 55,000.
- Quick answers met decision 2: 7.2 took 4 s, and the cross-thread lookups XA and XC took 6–7 s, against
  ~7 s for today's router plus compact call.

**Reading and routing.**
- She declared a reading on every turn that used a wardrobe tool, and passed place, date, evening and
  walking where the user gave them (6.1, 7.1).
- The trip follow-up (5.2) answered from the plan. There was no replan.
- "A few options" gave three on every options request.
- After the season fix, 7.1 had a real layer on all three looks and stated the evening's mid-50s to
  mid-60s.

**Still failing, not caused by this change:**
- **3.2, the doubt.** She dresses the jeans without saying whether she still stands by her pick. This
  failed both times, rebuilt and continued. Item 105's fix is in `STYLIST_SYSTEM` and was present; its
  passing run was on `gemini-3.7-flash`, this check on Flash-Lite.
- **2.1** states no assumption about cooking or serving.
- **4.1**'s third option has cutout flats for a lawn.
- **6.1** gives no fire-pit caution.

These are known check-set failures, seen before on the router's paths.

**Gap found:**
- **Trip follow-ups always rebuild.** The lean trip follow-up prompt (`tripFollowupTurn`) leaves out the
  wardrobe manifest, so its stable half never matches the trip's first turn. Closing it means keeping the
  manifest on trip follow-ups and moving the trip guidance below the breakpoint.
  - **[fixed 2026-11-11, offline]** Done that way. `buildStylistConversationPayload` now keeps the
    wardrobe list on a trip follow-up, and the trip guidance became `tripFollowupGuidanceText` (what the
    suitcase was packed for, how a day away works, "the plan on screen stays") below the breakpoint.
  - The trip follow-up's own tool list is unchanged; it is sent per call.
  - Trade: a trip follow-up that rebuilds carries the list again, about 35k tokens (the 2026-10-07 lean
    turn's saving). A continued one reads it from the cache.
  - Test: `test/one_stylist_per_thread.test.js`, where a trip follow-up fingerprints the same as its first
    turn. Not run live.
- The size limit stays provisional at 150,000 tokens. One continued photo turn reached 95,000, so it would
  be hit after two or three more.

**Verdict: keep.**
- The architecture did what it was for: one stylist, her own reading, and follow-ups continued faster and
  cheaper.
- Both faults it introduced were found by this check and fixed.
- The remaining failures are the check set's existing ones.

**Next:** delete the unreachable router code (one commit, see "As built"), then close the trip follow-up
gap.

## Second live check (2026-11-11, after the deletion and the trip fix)

**Setup.**
- 5 turns on `gemini-3.5-flash-lite`, $0.21, same harness and data copy.
- It checked the four changes that had been offline only: trip follow-ups continuing, travel detection,
  `readTheSituation`, and `HOW_A_DAY_AWAY_WORKS`.

**Results.**
- **Trip follow-up continued** (5.2): 10 s and 1.6¢, against 13 s and 2.6¢ when it rebuilt. It swapped in
  a packed sweater, with no replan. The thread's stored plan holds the right dates.
- **No travel-weather stop on the at-home plan** (1.1). There was no weather question; rain was stated,
  and a raincoat went on the Friday market look.
- **The room was read** (3.1): "polished, respectful, and comfortably approachable".
- **The doubt follow-up continued** (3.2, 1.3¢), and still failed the same way on Flash-Lite.
- **A fault found:** 5.1's reply said "November 12 through November 15".
  - The stated-date override had planned 19–22 November correctly. Those dates reached the stylist only
    inside the weather data, and she repeated the dates she had passed.
  - Fixed offline: `withPlannedDates` (`tools.js`) puts a `planned_dates` line first on the planner's
    result. When the user's words replaced her range, it names the old range and tells her to state the
    new one.
  - The first run's correct dates were luck.

## 3.7 Flash for the chat (2026-11-11)

**Owner: "switch to Flash 3.7".** The chat stylist has its own model, `CHAT_STYLIST_MODEL`
(`CHAT_STYLIST_MODEL_OVERRIDE`): `gemini-3.7-flash` on Gemini, used by `/ask` only. The other ~35 call
sites of `stylistProviderOverride` keep `STYLIST_MODEL_OVERRIDE`.

**The same 15 turns on 3.7 Flash** (medium thinking, $1.80; scores in
[stylist-check-set.md](stylist-check-set.md)):

| | Flash-Lite | 3.7 Flash |
|---|---|---|
| Cost, 15 turns | $0.78 | $1.80 |
| A fresh card turn | 20–60 s | 45–190 s |
| Continued follow-ups | 4–10 s | 10–47 s |
| The doubt follow-up (entry 3) | fail every run | pass |

**Judgment, 3.7 better on:**
- the doubt follow-up;
- a shoes-off house considered;
- a breakfast look per morning, with the reason;
- the right trip dates, and honesty that the overcoat is not rainwear;
- an option she no longer stands behind, said openly.

**Still failing on both models:** no fire-pit fabric caution; thin readings of how dressed an occasion is;
linen in November on one option.

**Latency is the cost.**
- The quick-answer target of decision 2 (about 7 s) is missed: the fastest follow-up took 10 s, and a
  slot swap 47 s.
- Three of the four continued 3.7 follow-ups reported no cached input on their first call; the "Really?
  jeans?" turn reported 97%. Flash-Lite's continued calls were cached. Why is not yet known.

**Thinking level, measured the same day.** The same 4 turns (entries 3 and 7, with follow-ups) on 3.7
Flash at low thinking cost $0.33, the same as medium.

| Turn | Medium | Low |
|---|---|---|
| "Why that jacket?" | 10 s | 5 s |
| "Really? jeans?" | 27 s | 20 s |
| Boss's dinner | 66 s | 52 s |
| Gallery (mostly the options composer) | 45 s | 46 s |

- **The judgment held:** the doubt follow-up still passes, and every gallery option has a layer with the
  evening temperature stated.
- **One small loss:** the shoes-off thought on the boss's dinner.
- **Set:** `CHAT_STYLIST_THINKING_LEVEL`, default low, through `chatThinkingLevelFor` (`provider.js`). It
  applies to `/ask` on 3.7 Flash only.
- **Unchanged:** Flash-Lite and every other caller of the loop keep medium. That medium was set for
  Flash-Lite, where low meant no reasoning at all; the cases are named beside
  `GEMINI_STYLIST_LOOP_THINKING_LEVEL`.
- One run of four turns.

**Still to measure:** 3.7's caching on continued turns.

## The system prompt was never inherited (2026-11-11, engine map item 113)

**The fault.** Reading back stored interactions showed that a continued Gemini call carries the conversation but
not the system prompt. Google's docs confirm it: system instructions are interaction-scoped. Every Gemini call after
a turn's first had therefore run without the stylist's instructions, constitution, wardrobe list and turn context,
from the adapter's first version on.

**Changes to this design:**
- The system prompt is sent on every call.
  - **[amended the same day, after the fair run]** For the chat on Gemini it is the stable half only
    (constitution, profiles, wardrobe list). The turn's context opens the turn's message
    (`splitPromptForGeminiThread`).
  - With the turn's context in the system prompt, every turn's request started differently, so no continued
    turn's first call reused the cache: "Really? jeans?" read 131,780 tokens with none cached, 14¢ against
    1.9¢.
  - Other callers of the loop keep the whole prompt in the system slot.
  - **Confirmed live:** the next continued follow-up read 97% of its 138k input from the cache, at 4.3¢ against
    14.2¢.
- The prompt-fingerprint rule is removed. A changed wardrobe list or prompt now reaches a continued conversation
  directly.
- A conversation is continued only from an interaction that ended in a reply (`complete`). A turn ended by an
  options batch or a plan rebuilds the next turn (`last_turn_unfinished`).

**Effect on the measurements above.**
- Every live score in this document and in the check set was produced with this fault.
- The "Really? jeans?" follow-up is a continued call, so it never saw item 105's instruction. That may explain why
  it failed on Flash-Lite every time.
- Speed is unlikely to change much: latency tracks output tokens (correlation 0.96), not input. Cost per continued
  call rises slightly, since the system prompt is resent; most of it should come from the cache.

## The single-outfit guidance, restored (2026-11-12)

**Owner:** the boss's-dinner answer on the one stylist (thread_1794470249476) was worse than the single-outfit
route's (thread_1794365607999).

**What the old answer had:**
- a complete look with a coat for the way there;
- a reason and styling instructions on the card;
- two worked jeans outfits on the doubt.

**The cause.** Retiring the single-outfit route carried over two parts of its prompt (`readTheSituation`,
`HOW_A_DAY_AWAY_WORKS`) and dropped the rest:
- the wearability contract, with "layering applies to travel to a venue";
- the 8–12-piece visual workbench;
- the rules for the note;
- `why_it_works` as a required field.

None of these was in the full stylist's prompt.

**Restored.**
- `ONE_OUTFIT_GUIDANCE` (`prompts.js`) goes in the full stylist's stable prompt, after the situation read.
- `why_it_works` is required on `propose_outfit`.
- A one-card proposal with a note now ends the turn with that note on a new request too, unless the outfit
  check left notes for her to answer. As on the single-outfit route, this saves the closing call.

**Live recheck** (entries 2 and 3, 3.7 Flash, low thinking, $0.37):
- **Better:** the boss's-dinner card now carries a cream trench "for the arrival and departure transit",
  tweed trousers, boots and earrings, with a reason and styling instructions. The hosting options give
  hosting reasons (plating food, pouring drinks).
- **Not yet in that run:** the reply showed only the note's first paragraph, because the note was still
  dropped on new requests. That is what the ending change fixes, offline only.
- **The doubt failed again** ("You can definitely wear jeans!"). At low thinking on 3.7 Flash it has passed
  2 of 4; the two runs at medium passed.

**Rerun of entry 3 after the note change** ($0.14):
- The reply is her full note: what the occasion asks, the pick and why, boots that clear the hems, and the trench
  for evening transit.
- The turn took 22 s with three calls and no closing call. Its first call read 95% from the cache.
- **New fault:** ending on the note left the turn's interaction owed the proposal's result, so the follow-up
  rebuilt (`last_turn_unfinished`).
  - Fixed offline: the owed results are kept with the stored conversation (`pending_results`) and sent first on
    the next turn, as function results ahead of the new message.
  - This also covers turns that end on an options batch.
- The doubt failed again ("Jeans can absolutely work"). At low thinking it is now 2 of 5.

## Medium thinking on each turn's first call (2026-11-12)

The chat now thinks at medium on a turn's first call (`CHAT_STYLIST_FIRST_CALL_THINKING_LEVEL`) and at low after
it. Live test: entries 1 and 3, twice each, 3.7 Flash, about $1.04.

- **Breakfast looks are back** in both at-home plans (thread_1794470249474 had lost them). Run 2 gives Friday and
  Saturday cooking looks with the reason; run 1 gives a Saturday breakfast look and explains Friday's washable
  market look.
- **The doubt is still not fixed:** run 1 failed ("Jeans can absolutely work…"); run 2 named the cost but took no
  stance. It passed when the first pick was a knit dress and failed when it was a silk blouse with trousers, so
  the pick may matter more than the thinking level.
- **Follow-ups continued** with the owed results sent first. But only about 55.7k of 132–145k input tokens came
  from the cache, about the size of the system prompt alone. Not yet explained.
- **One turn failed** (run 1, the boss's dinner): "I ran out of steps before I could finish this one". Its third
  and fourth calls stopped at the output cap (1,496 of 1,500 tokens). At low thinking `callGeminiTurn` gave no
  headroom over `maxTokens`, but low on 3.7 still thinks, and the thinking counts against the cap. The first call
  at medium had the 4,000-token headroom, so the failure appeared only after the split.
  - **Fixed:** low-thinking calls now get 2,500 tokens of headroom
    (`GEMINI_STYLIST_LOOP_LOW_THINKING_HEADROOM_TOKENS`). Unused tokens are not billed. Covered by
    `test/gemini_call_turn.test.js`.
  - **Rerun live** (entry 3, $0.30): the boss's-dinner turn finished. Its third and fourth calls wrote 1,702 and
    3,209 output tokens, so both would have been cut at the old 1,500 cap.
  - In that run she dressed the dinner from the packed Portland suitcase and said so. That is the open-plans rule
    working: the test copy holds a Portland trip planned for Nov 12–15, which covers Friday the 13th.
  - Doubt: "The black trousers were my conservative pick… dark, clean jeans cost you virtually nothing", and a
    jeans swap card. She takes a stance and gives the reason she changed it (pass).
- **Why follow-ups cached only part of their input:** Gemini keeps its cache separately for each thinking level.
  In the rerun's calls (ai_call_log 3560–3573), every call read the previous call's whole input from the cache,
  except where the level changed:
  - the first turn's second call (low after medium) read 0;
  - the follow-up's first call (medium after low) read 55.7k of 143k, which is what the first turn's medium call had
    left;
  - the follow-up's second call (low) read 136.8k, all of the previous turn's history.

  That one call cost 7.4¢ against about 2¢ fully cached.
  - **Fixed:** a turn that continues the stored conversation now thinks at low from its first call, so its history
    reads from the cache. New conversations, and turns that rebuild, still start at medium, which is where the
    breakfast looks came back.
  - On the doubt line the level has made no clear difference (low 2 of 5; medium fail, partial, pass).
  - Not yet rerun live.

## Decisions (2026-11-11)

The owner's direction: these conversations should be as good as they can be, and a quick question gets
a quick answer. How that is achieved is an engineering decision, made here. Each decision names the
outcome it serves, the measurement that checks it, and what would reverse it. Latency and cost below
are `ai_call_log` averages since 15 Oct on a copy of the owner's data. That traffic is owner testing,
not user behaviour.

| Call | Average | Input | Cost |
|---|---|---|---|
| Router (`gemini-3.7-flash`) | 3.8 s | ~2,400 tokens | 0.24¢ |
| Router (`gemini-3.5-flash-lite`) | 2.4 s | ~2,400 tokens | 0.16¢ |
| Compact answer (Flash-Lite) | 3.5 s | ~9,400 tokens | 0.39¢ |
| One full-stylist call (Flash-Lite, cold) | 5.0 s | ~41,000 tokens | 0.96¢ |

1. **The router goes, in the target.**
   - **Why.** It adds 2.4–3.8 s before every turn, and it is a second reader of the user's words whose
     misreads have needed their own fixes (engine map item 85; the 2026-11-11 router check, case B).
     One stylist reading the conversation she is in has the context the router never had.
   - **What survives.** Its structured reads (`setting`, `time_of_day`, `occasion`, `activity`,
     clarifying questions) move into `declare_intent` (change 2).
   - **How it goes.** It is removed in the build. The 2026-11-11 router checks are the comparison set
     for her declared reads.
   - **Reversed if** her reads are wrong more often than the router's were on those cases, or on the
     check set.
2. **No separate one-call answer path. A quick question gets a quick answer from her.**
   - **The outcome is time to answer, not the number of calls.**
     - Today a quick answer is router plus compact call: ~7 s, ~0.6¢.
     - In a continued conversation, a question she can answer without tools is one call with no
       router: ~5 s, with the history cached.
   - **Fresh threads too.** On a fresh thread's first turn it is the same one call, cold, ~1¢. That is
     slower to bill, not to answer.
   - **The measure.** Time from send to answer on questions that need no tools (check-set "why" and
     garment-fact follow-ups): no worse than today's ~7 s.
   - **Reversed if** her quick answers are slower than that, or worse than the compact path's on the
     same questions.
3. **Size limit: rebuild when a continued turn's input would pass 150,000 tokens.**
   - **Why.** Per-call latency grows with input, and today's stylist calls are ~41,000 tokens at ~5 s.
     A quick answer must stay quick, so the limit is set by latency. 150,000 is provisional.
   - **The verification run replaces it.** That run measures latency against input size and photos per
     turn. The limit
     becomes the size at which a no-tools call passes ~2× today's latency.
4. **Retention: continue a conversation only if its last turn was within 7 days; otherwise rebuild.**
   - **Why.** The usage pattern is a few days of conversation, then a week or two away. After a week,
     what was established (weather, plans, what she was looking at) is stale anyway, and stored memory
     is the right starting point. That is the "back days later" design.
   - **Privacy.** Seven days also keeps the least of the user's conversation on the provider's side. The
     rule is in code, so it holds for every user's own API key, whatever their retention setting.
   - **For the operator.** The operator's own Google AI Studio project can be set to the shortest
     retention offered, 7 days, to match. That setting is in the owner's account; the app does not
     change it.

## Not in this proposal

- **Better memory for coming back after days.** This means a running record of decisions and objections,
  earlier option sets kept instead of replaced, and a check that stored weather and dates are not
  treated as current on return. It is a separate piece of work: rebuilding a conversation is what makes
  that memory matter.
- **Critique and launched-piece flows.** These are started from buttons, use their own endpoints, and
  stay as they are. This proposal covers typed `/ask` chat.
- **Across threads.** See [cross-thread-continuity.md](cross-thread-continuity.md).

