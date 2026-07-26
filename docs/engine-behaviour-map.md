# Engine behaviour map

**Status:** first pass, 2026-07-26. Companion to `docs/app-surface-map.md`.

## What this is for

The surface map is derived UI-first — routes, tabs, mode gates, dialogs — so it is **structurally
blind to anything that never renders**. Every non-UI behaviour that reached it got there by
accident: one from a screenshot, one from an unrelated grep, one because the owner pointed at a
panel footer.

This map walks the other axis: **writes, prompt splices, retry loops, caches and sweeps.** That is
where the expensive surprises live, because none of it is visible to the owner or to a review panel.

Derived by `scratch/derive_engine_behaviours.js` (read-only, no model call). It finds *mechanisms*,
not intent — a side effect is not automatically wrong. Same tags as the surface map:
**[by design]**, **[known bug → ref]**, **[unverified]**, **[owner check wanted]**.

---

## Side effects — writes that happen as a consequence of something else

Ninety-two write sites exist across the codebase. Most are ordinary CRUD, where a request says
"save this" and the handler saves it. **Seven originate inside `styling-engine/`**, which means
they fire as a side effect of composing or answering, not because anyone asked:

| write | trigger | entry |
|---|---|---|
| `stylist_conversation_state` | every stylist turn | thread state, below |
| `stylist_feedback` (`owner_rule`) | model decides you stated a durable preference | surface map → message-level actions |
| `whole_wardrobe_sessions` INSERT + DELETE | every whole-wardrobe generation | recency memory, below |
| `todos` (`metadata`) | a hard gate excludes a garment for missing data | surface map → Tasks |

Plus, from `routes/crud.js`, a single `PATCH /api/saved-boards/:id` fans out to **three** further
writes — retag-suggestion todos, a feedback mirror, and a structured-reason sync. One user action,
four writes, one of them landing in a different feature.

---

## Server-side thread state

**[by design]** `stylist_conversation_state` stores, per session, the established context and the
current outfit set — occasion, activity, season, mood, mission, the active outfit and its piece
ids. On any follow-up turn (anything not flagged `new_request`) the server **restores it and fills
gaps the client omitted**. Body values always win; state only fills blanks.

Why it exists: a follow-up like *"make it warmer"* carries almost nothing, and the thread would
otherwise lose what it was talking about. The comment is explicit that this exists so the thread
*"survives the client omitting fields."*

**Consequence worth knowing:** the same request can behave differently depending on what the server
remembered from earlier in the session, and nothing in the UI shows what was restored. If a
follow-up produces something unexpected, restored state is a candidate — check
`getStylistConversationState` before assuming the prompt or the gates changed.

> `styling-engine/core.js:3419` (restore), `:3824` (read), `:3839` (write); mirrored in
> `tools.js:1803`.

---

## Recency memory, and its cap

**[by design]** Every whole-wardrobe generation appends a row to `whole_wardrobe_sessions` holding
the piece ids and formula families it used, then immediately **deletes everything outside the
newest 10**. So the memory is a rolling window of the last ten generations, not an unbounded log.

That window is what produces *"Skipping N recently used pieces"* in the composer footer, penalising
recent pieces in scoring and reordering the roster. **Include them again** clears the table
outright.

**[by design]** The trim runs on every save, so the table cannot grow. Worth knowing when reasoning
about why a piece reappeared: eleven generations ago is invisible.

> `styling-engine/rules.js:1465-1474`. Surface counterpart: surface map → composer landing panels.

---

## Retry loops around model calls

Two, both in `askStylistWithTools`, and both cost money when they fire.

**[by design] The tool loop runs up to 10 iterations.** The comment records the reasoning and the
history: the disciplined flow — declare, search, view supports, view layers, propose ×N —
legitimately needs 6–8, and *"the old cap of 7 left no margin for a single corrective bounce and
live turns died with zero cards."* So 10 is a deliberate margin, raised after live failures.

**[by design] Output guards retry up to 6 times, one retry per guard.** `applyFreeformOutputChecks`
inspects the finished answer; if it violates a guard, the model is re-prompted with a correction
message. `retriedChecks` ensures each distinct guard only triggers one retry, so the loop cannot
ping-pong on the same violation.

**Consequence:** a single user turn can be several model calls — tool iterations plus guard
retries — and nothing surfaces that. When a turn feels slow or a bill looks high, this is the first
place to look. Relevant to any cost-instrumentation work, which currently measures none of it.

> `styling-engine/provider.js:734` (guard retries), `:758` (tool loop).

---

## Prompt splice sites — what actually reaches the model

Where accumulated memory becomes prompt text. Traced 2026-07-26; each was verified by running the
builder against the real wardrobe rather than read from source alone.

- **`getSavedBoardMemory`** → board verdicts *and* specific reasons, in plain language, under
  *"Bias future outfit suggestions toward these successful formulas"* / *"Avoid repeating these
  drift/problem patterns"*. ~3.2 KB on the current wardrobe. Spliced at `core.js:2683→:2737` and
  `routes/ai.js:1108-1109→:1116` (per-garment, flagged *"high-authority outfit memory"*) and
  `:1119` (global, *"should bias ranking"*).
- **Owner rules** → injected as **hard requirements**: *"OWNER RULES — hard requirements, not
  suggestions. Do not construct exceptions or conditional workarounds… If a rule makes a slot
  impossible, disclose the conflict instead of bending the rule."* (`outfitSetPlanner.js:1120`.)
- **Style Constitution layers** → all four reach **eight** prompt templates, not just the image
  prompt: `STYLIST_SYSTEM`, `STYLE_SELECTED_ITEM_SYSTEM`, `GENERATE_OUTFIT_IDEAS_SYSTEM`,
  `OUTFIT_COMPOSER_SYSTEM`, `OUTFIT_BOARD_PLANNER_SYSTEM`, `EDITORIAL_NEW_PIECES_SYSTEM`,
  `WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM` (twice), plus `editorialImagePrompt`. Cached per user and
  invalidated on any write (`promptRuntime.js`), so an edit takes effect next request.
- **[known bug → `docs/board-feedback-desync-spec.md`]** The `stylist_feedback` mirror of grouped
  reasons reaches nothing: `getStylistFeedbackMemory` excludes rows whose board already exists in
  `saved_boards`, which is every row that mirror produces.

---

## Sweeps

- **[by design]** `whole_wardrobe_sessions` trimmed to the newest 10 on every write.
- **[by design]** `POST /api/todos/clear-orphaned` deletes `metadata` todos whose linked piece is
  gone or inactive. Only `metadata`; user-created and retag tasks are never auto-deleted.
- **[by design]** Retag-suggestion todos for a board are deleted and rebuilt whenever that board's
  feedback changes — but completed `piece:issue` pairs are collected first and skipped, so a
  suggestion you have handled never returns.

---

## Still to map

- **Scoring functions and their weights** — `planWorkbenchPieceScore` (the 30-point
  `fit_confidence` bonus was found only by reading), `capsuleVersatilityScore`,
  `compatibilityScoreForSelectedItem`, `getFeedbackInfluenceForPair`.
- **The gates themselves** — register ceiling, activity profiles, weather physics, occasion
  validity: what each excludes and on what evidence. Partly covered in
  `docs/stylist-bugfix-spec.md` and the gate history, not yet consolidated.
- **Caches** — prompt runtime (per user, invalidated on write), thread cache, thumbnail cache.
  The derivation script over-reports here: most `new Map()` hits are local lookups, not caches.
- **CI ratchets** — the text-matching ratchet and style-claims guard constrain what future code may
  do, and are invisible until they fail a build.
- **The import pipeline's own model calls** — classification batches, and the per-garment tagging
  step the owner identifies as the single most expensive operation.
