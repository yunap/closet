# One stylist per thread

**Status:** active — built 2026-11-11 on `feat/one-stylist-per-thread` (owner: "build it"). Offline suite green;
**not yet verified live**. Keep-or-revert follows the check-set run described under "Build". The design below is as
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

**Left in place until the keep-or-revert decision.** These are unreachable from `/ask` but still
unit-tested:
- `routeFreeformExecutionProfile` and `FREEFORM_EXECUTION_ROUTER_SYSTEM`;
- the compact-answer helpers (`compactFreeformContext`, `compactFreeformAnswerSystem`, …);
- `buildSingleOutfitConversationPayload`;
- core's `tripPlanTurn` and `answerInWords` branches.

If the build is kept, they are deleted in one follow-up commit. If it is reverted, one commit restores the
route.

**Tests.**
- Removed with their paths: `test/bounded_multi_context_continuity_e2e.test.js`, and eight route-shape tests
  in `freeform_observability` and `aiEndpointContracts`.
- Re-pointed to `declare_intent`: the occasion/activity/season lock, the indoor-destination setting, answer
  in words, and the trip replan guard.
- New: `test/one_stylist_per_thread.test.js`.

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

