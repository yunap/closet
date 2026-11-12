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
- **Ranking.** Distinctive words the user themselves said (title and user messages, rarity measured over
  user messages) come first. Then distinctive words anywhere, including the cards' garment names. Then
  recency. This was refined by the live check below; the first version follows.
- **Ranking (first version).** Threads that share the query's distinctive words come first, newest first. A word is
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
  - `plan`: the thread's dated plan, if it has one, with `packed` (the suitcase: the thread's
    `packing_roster` pieces, each with `still_in_wardrobe`; added after the live check).
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

## Live check, 2026-11-11

**How it was run.**
- Six messages, each in a new thread, through the real `/api/ai/ask` route in a development server.
- Data: a copy of the owner's data (`sqlite3 .backup` of `wardrobe.db` and `system.db`, a `cp -c` clone
  of `uploads/`). The live data was never opened.
- Models: `gemini-3.5-flash-lite` for the stylist, `gemini-3.7-flash` for the router.
- Script: `scratch/run_cross_thread_live_set.mjs`, untracked, with `--dry-run`. Each case was scored from
  the provider wire captures, not from the reply alone.
- The Portland thread's `plan` was set on the copy from that turn's own recorded resolved values; plans
  made before this change have none.
- Cost from `ai_call_log`: about 29¢ for eight stylist turns (first run of A–F, then B and F again after
  the fixes below). Add about 3.5¢ for the router-only checks.

| Case | Message | Result |
|---|---|---|
| A | "What did you suggest for the gallery opening?" | **Pass.** She searched for "gallery opening" and recounted the three cards of the 11 Nov thread exactly (titles and pieces checked against the thread), then offered to revisit them. No cards. |
| B | "For my Portland trip, what should I wear if Saturday's dinner turns cold?" | **Partial**, twice. She found the plan and kept its "Saturday Dinner Out" look (98, 183, 155), adding a jacket. Both runs added a jacket that was not packed (207, then 250) and did not say so. The second run already had the plan's `packed` list (below). No forecast was used: her search passed no place or date. |
| C | "Remind me what we picked for my sister's graduation." | **Pass.** She searched "graduation", then "sister", then made an empty search, and said she had no record of it. She offered to build one. |
| D | "What should I wear to brunch with my sister on Sunday the 22nd?" | **Pass.** It went `single_outfit`, with no search and no mention of Portland. |
| E | "Help me think through Friday evening, I'll be out with my friend." | **Miss.** The router saw the plan and chose `full_stylist` (words), and her prompt carried the open-plans block. She still answered as if it were an evening at home, with no mention that Friday falls in the Portland trip. A model judgment miss, not missing information. |
| F | "I'm hosting another get-together at home this Saturday. Last time I told you I wasn't a fan of the sneakers…" | **Fail, then pass after the fixes.** In the first run she searched "hosting home", the 2 Oct conversation with the objection was not returned, and she answered as if she remembered it ("swapping out the sneakers"). In the second run she searched "get-together home sneakers", then "sneakers". The objection thread came first, and she proposed flats. |

**Fixed during the check:**
- **Ranking.** The user's own words now outrank a word that appears only in a card's garment names, and
  how rare a word is in user messages is measured over user messages alone.
  - Before: "sneakers" appears in hundreds of cards' garment names but in few objections, so it never
    counted as distinctive, and newer threads with sneakers on a card won.
  - After, on the copy: "sneakers" and "get-together sneakers" both put the 2 Oct objection first.
  - "hosting home" alone still cannot find it.
- **Packed pieces.** A plan in a result now includes `packed`, the suitcase, from the thread's
  `packing_roster`. The cards alone do not show it, since a card's packed layer is not one of its pieces.
- **Tool description.**
  - Pass all of the user's distinctive words.
  - Say only what the results show; if the conversation is not among them, say so rather than answer as
    if remembered.
  - Name any piece added that is not in `packed`.

**[amended 2026-11-11] B decided and fixed — owner ruling: "Use its suitcase".**
- **The change.** When `search_past_conversations` returns a conversation whose plan has not ended and has
  a packing roster, `adoptOpenPlanSuitcase` (`pastConversations.js`) puts that roster in force for the
  turn: `toolContext.packingRosterIds`, `packingRosterPieces` and `packingRosterSlots`.
- **Effect.** The trip thread's own code now applies:
  - `search_wardrobe` marks `in_packing_roster`.
  - `propose_outfit` shows an unpacked piece as a proposed packing-set change on the card.
  - The tool result carries a `suitcase_in_force` line saying so.
- **Limits.**
  - The first matching result wins.
  - A roster already active on the turn is never replaced.
  - The roster is **turn-only**. It is not written into the new thread, which would make that a trip
    thread with the trip follow-up prompt (`boundedConversationStateFromToolContext` skips it). The
    original trip's suitcase is not changed from here.
- **Re-run of B** (one live turn, 3.9¢, `search_past_conversations` "Portland"): she kept the Saturday
  dinner look and added the packed dark grey cashmere vest (142), calling it packed. Pass.
  - A styling note, not this feature: for a cold Portland evening the look has no coat for the way there,
    and the plan's packed raincoat was not mentioned.

**Left for a decision** (the first item was decided above):
- **B, unpacked pieces.** In the trip's own thread, the packing roster makes an unpacked piece a "proposed
  packing-set change", which she has to name. In a new thread that roster is not in force, and naming the
  rule in the tool description did not make her follow it. Two structural options:
  - When a new thread's request is about an open plan, adopt that plan's packing roster for the turn.
  - Point the user back to the plan's own thread.
- **E, the trip day.** The block reached her and she did not use it on Flash-Lite. One run; no wording
  change was tried.

**[amended 2026-11-11, later the same day]** The execution router was retired from `/ask`
([one-stylist-per-thread.md](one-stylist-per-thread.md)). The router-context line and its rule are
removed: `routerOpenPlansContext` and `openPlansRouterContext` are deleted. Every typed turn now reaches
the full stylist, which already sees the open-plans block. The routing problem in case B no longer exists.

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
