# Continuity across Stylist threads

**Status:** Implemented 2026-11-11 on `feat/cross-thread-continuity`. Owner decision the same day: build it
without a paid test first, since the app is not in production. Not yet run live.

## The problem

The Stylist chat is separate threads. That is deliberate: a thread is the user's own unit of topic, and
search and the thread rail depend on it. Starting a new thread also means starting clean, which is often
what the user wants.

Until now, though, nothing the user and the stylist did together in one thread could be reached from
another. Only Style Lab memory and feedback carried across, and those are what the user *taught* her,
not what they *did*:

- "Something like what you suggested for the wedding" had nothing to look up.
- A trip planned last week was unknown in this week's thread, even for a day the user would be away.

A stylist who forgets every earlier appointment is not the job the README sets
([README.md](../README.md), "Who it is for").

## What was built

Threads stay separate. Two things now reach across them, and both carry only what the user wrote or
decided.

### 1. `search_past_conversations`, a tool she calls when needed

She calls it when the user refers back to an earlier conversation, or when the request plainly continues
a plan made in one. It costs nothing on turns that don't use it.

- **Input.** `query` takes words from the user's message; an empty query lists the five most recent
  other conversations. `limit` is 1–5, default 3.
- **Matching.** Whole words from the query (stop words dropped) are matched against each thread's title,
  the user's messages, and the cards' titles and garment names.
- **Ranking.** Threads that share the query's distinctive words come first, newest first. A word is
  distinctive when it is found in few threads: at most 10% of them, or two. A place or an event is
  distinctive; "pack" or "dinner" is not. Only when no query word is distinctive does the number of
  matched words decide.
  - Why: on a copy of the real wardrobe (663 threads), ranking by matched-word count put three older
    Portland threads that said "pack" above this week's Portland trip, which said "carry-on" instead.
  - Same copy after the change: "what did you pack for Portland" returns this week's trip first. Three
    results were about 1,300 tokens; "gallery opening" was about 900.
- **Scope.** The current thread and archived threads are excluded.
- **What a result returns:**
  - `title` and the thread's dates.
  - `user_said`: the user's own messages. A long thread is cut to six: the first, the matching ones and
    the latest ones, where objections and decisions usually are.
  - `cards_shown`: the cards shown, as a title plus pieces, each piece with `still_in_wardrobe`. Broken
    and diagnostic-only cards are left out.
  - `user_verdicts`: the user's reactions recorded against the thread (`stylist_feedback` rows whose
    payload names the thread), with any note they typed.
  - `plan`: the thread's dated plan, if it has one.
- **What it never returns:** the assistant's prose, or a card's reasons and watch-for text. Her earlier
  reasoning would come back as if it were fact ([assistant text is not user evidence]). A card title is
  hers too, and is kept only so a card can be told apart.
- **Verification is unchanged.** A piece in a result is not verified: she must call `view_pieces` before
  citing or composing it, as for `recently_discussed_pieces`.
- **Weather and dates** in an earlier conversation describe that time, not now (tool description).

**Where it is offered:**

- The full stylist: all tools.
- The trip follow-up's tool list.
- The informational / answer-in-words lists.

It is not offered on the compact profiles, `single_outfit` or the lean `trip_plan` turn. Instead the
router sends a request that refers to an earlier, separate conversation to `full_stylist`
(`FREEFORM_EXECUTION_ROUTER_SYSTEM`).

### 2. Open plans, one line each, every full-stylist turn

- **What is saved.** When `plan_outfit_set` builds a dated plan, `persistFullStylistTurnState` saves the
  plan's resolved facts in the thread's state as `plan`: `kind`, `location` (trips only), `start`, `end`
  and `date_source`. They come from `planSummaryFromToolContext`, read from the plan tool's own resolved
  values, never from the reply. Follow-ups keep it; a new plan replaces it.
- **What the stylist sees.** `openPlansFromOtherThreads` lists every other non-archived thread whose plan
  has not ended (in the user's time zone). `openPlansPromptText` gives each one a line: kind, place,
  dates, the thread's title and when it was planned. The block sits below the cache breakpoint in
  `buildStylistConversationPayload`.
- **How she may use it.** Only when the request falls on those dates or concerns the same trip or event,
  and she then says which plan she took it from. She does not bring the plans up otherwise.
- **No weather.** A stored forecast describes the day it was fetched, and outdoor weather is not raised
  unless asked ([no outdoor weather unless asked]).
- **Undated plans** (a capsule without dates) are not open plans.
- **No plans, no block.** With no open plans the block is empty and the prompt is unchanged (Engineering
  Principle 6).

## Authority

Both are **history and context**, not preference memory. Nothing here becomes a rule, a score or a gate,
and a verdict found through search is evidence of what the user wanted then, not a standing instruction.
Standing preferences stay in Style Lab and feedback, unchanged. Recorded in
[feedback-and-memory-map.md](feedback-and-memory-map.md) §7.

## Deliberately not done

- **No automatic summaries of recent threads.** These would pull old topics into new ones, bring her own
  reasoning back as fact, and carry stale weather.
- **Saved outfits (My Outfits) are not broadcast across threads.** That is the existing rule (§2 of the
  memory map: relevant-context only). A card the user saved is still found through search, because the
  search reads the thread it came from.
- **No "continue from this thread" button yet.** It is a UI change, and a material one needs the expert
  panel (AGENTS.md).

## Open

- `single_outfit` does not see open plans. "What should I wear Friday?" while Friday is inside a trip
  went to the single-outfit path with the home forecast, unless the user named the place. **Addressed
  2026-11-11:** the router now sees the open plans and sends such a request to `full_stylist` (see the
  router check below).
- Matching is by whole words. A user who says "the Oregon trip" for a thread that only ever said
  "Portland" finds nothing, and she is told to say so rather than guess.
- **Router check, 2026-11-11.** One call per message on `gemini-3.7-flash` at low thinking, with a new
  thread's compact context; 13,782 input and 817 output tokens in total. The probe is
  `scratch/probe_router_back_references.mjs`, untracked.

  | Case | Message | Routed to | Result |
  |---|---|---|---|
  | A | "What did you suggest for the gallery opening?" | `full_stylist` (words) | as expected |
  | C | "Remind me what we picked for my sister's graduation." | `full_stylist` (words) | as expected |
  | E | "Help me think through Friday evening…" | `full_stylist` (words) | as expected |
  | F | "Last time I told you the heels were too much…" | `full_stylist` (words) | as expected |
  | D | "What should I wear to brunch tomorrow?" | `single_outfit` | stays out, as expected |
  | B | "For my Portland trip, what should I wear if Saturday's dinner turns cold?" | `single_outfit` | **missed** |

  Why B missed: the router cannot know a Portland plan exists in another thread, and "my Portland trip"
  does not say it was planned with her. This is the same gap as the `single_outfit` item above. The
  likely fix covers both: give the router the open plans in its compact context.

- **[amended 2026-11-11, same day] Fixed.**
  - **What changed.** The router's compact context now ends with one clause:
    `open plans in other conversations: Trip to Portland, OR 2026-11-12 to 2026-11-15`. It is built by
    `routerOpenPlansContext` (`routes/ai.js`) and `openPlansRouterContext`, and is empty when there are
    none.
  - **The rule.** `FREEFORM_EXECUTION_ROUTER_SYSTEM` sends a request about one of those plans (the same
    trip or place, or a day inside its dates) to `full_stylist`. A request about another place, or a day
    outside every plan, is classified as usual.
  - **Re-run** with that context (3 calls, 7,172 input and 409 output tokens; `--open-plan`):
    - B ("For my Portland trip… Saturday's dinner turns cold") went to `full_stylist`.
    - "What should I wear on Friday?", a day inside the trip, went to `full_stylist`.
    - "Brunch on Sunday the 23rd", outside the trip, stayed `single_outfit`.

    One call each.
  - **Re-run of the six no-plan cases** after the router prompt gained these two sentences (6 calls,
    14,142 input and 689 output tokens): the same as the first run. A, C, E and F went to `full_stylist`
    and D to `single_outfit`. B went to `single_outfit`, which is right when no plan is known.
  - **Seen, not changed:** with the plan known, B came back `setting: not_stated` although it asks about
    cold.
    - On a new thread `not_stated` skips the forecast (`resolveWeather`, engine map item 85).
    - The only way past that is a tool call carrying `user_weather`. "Turns cold" is allowed to supply it
      (`userWordsStateWeather` true; `requestStatesWeather` false, checked offline).
    - So whether Saturday's Portland forecast is used is left to the model. This is the existing item-85
      ruling, not this change. Watch it on the live turn.
- **[amended 2026-11-11] Follow-ups erased the plan, fixed before any live run.** The full stylist's
  per-turn state write (`buildStylistConversationPayload`) and the bounded-options write in `/ask` both
  rewrite the thread state with a fixed set of fields, and neither carried `plan`. The first follow-up in
  a trip thread would have dropped its open plan. Both now keep it. A test covers the
  `buildStylistConversationPayload` write; the bounded-options write has no test yet.

  Not yet run: a full stylist turn using the tool. The only tests so far are offline:
  `test/cross_thread_continuity.test.js`, on an isolated DB.

[assistant text is not user evidence]: engine-behaviour-map.md
[no outdoor weather unless asked]: engine-behaviour-map.md

Both rulings are recorded in the engine map, item 85 (owner ruling 2026-10-19: the user's own words, not the
assistant's replies, say where and when clothes are worn; no outdoor-weather note unless asked).
