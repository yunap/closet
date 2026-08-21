# The message lifecycle

**Status:** active — **Last verified:** 2026-08-20

**One user message, from keystroke to answer.** Written 2026-08-20 by tracing the code, not by
summarizing the other docs. Every source anchor and count below was checked against the code on the
verification date; the token figures are measurements of the owner's wardrobe on that date, not
invariants.

Every other chat document in this repo describes a *destination* — what the visual composer does,
what outfit evaluation does, what `/ask` does once you are already inside it. None of them describes
the *journey*, and the journey is where the surprises live: a single typed sentence can reach ten
different server endpoints, and which one it reaches is decided by React state the user cannot see.

Read this first. Then read the flow doc for whichever destination you landed in
([flows/README.md](flows/README.md)).

> **Scope.** The path traced in full is the ordinary one: text typed into the Stylist chat box.
> Every other branch is named, with a pointer to the doc that owns it. Stage 9 lists the places
> where the same question gets a different answer depending on how the thread started — that section
> is the reason this document exists.

---

## The short version

```
user types  →  send()  →  [13-way client dispatcher]  →  one of 10 endpoints
                                    │
                                    └── ordinary text lands on POST /api/ai/ask
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    ▼                        ▼                        ▼
            local shortcut          execution router          full stylist
          (no model call)        (1 cheap model call,      (manifest + tools +
                                  may finish the turn)      up to 10 iterations)
                                             │
                                             ▼
                                  output guards → response envelope
                                             │
                                             ▼
                              client stores message + thread payload
```

Four things decide everything downstream, and three of them are invisible to the user:

| Decision | Made by | Visible to user? |
|---|---|---|
| Which endpoint | `send()` in `StylistChat.jsx` | No |
| Which execution profile | a model call inside `/ask` | No |
| Which tools are offered | `stylistToolsForTurn` | No |
| Which conversation mode | `classifyChatTurn` regexes, client-side | No |

---

## Stage 1 — The client dispatcher

**`src/components/StylistChat.jsx`, `send()` at [:4742](../src/components/StylistChat.jsx#L4742).**

`send()` opens by resolving its inputs from `overrides` first and component state second:

```js
const q                 = (overrides.input ?? input).trim()
const outfitToSend      = overrides.outfit ?? pendingOutfit
const pieceToSend       = overrides.piece ?? pendingPiece
const fileToSend        = overrides.imageFile ?? imageFile
const capsuleExpansionToSend = overrides.capsuleExpansion ?? pendingCapsuleExpansion
```

That override channel matters: most branches are unreachable by typing. They are reached by clicking
something — an outfit card, a piece tile, a "Find similar looks" button — which calls `send({...})`
with the context attached. Typing is only ever the *last* branch.

Three derived booleans then fire off a regex against the typed text:

```js
const editorialRequestPattern = /suggest ideal|ideal addition|…|not.*wardrobe|…|new item/i
const shouldGenerateEditorialVisuals = Boolean(pieceToSend && (effectiveEditorialVisualMode || typedEditorialRequest))
const shouldGenerateOutfits          = Boolean(pieceToSend && effectiveGenerateOutfitMode && !shouldGenerateEditorialVisuals)
const shouldGenerateActiveEditorialVisuals = Boolean(!pieceToSend && activeContext?.type === 'piece' && editorialRequestPattern.test(q))
```

Note `not.*wardrobe` in that pattern. With a piece active, typing *"is this not in my wardrobe?"*
matches, and the turn is routed to editorial image generation instead of being answered.

### The dispatch table

Evaluated top to bottom; **first match wins**. Line numbers are the `else if`.

| # | Line | Condition | Endpoint | Can typing alone reach it? |
|---|---|---|---|---|
| 1 | [4942](../src/components/StylistChat.jsx#L4942) | `useCapsuleExpansion` | `/ai/expand-capsule` | No — button, and `q` must equal the button's own prompt |
| 2 | [4980](../src/components/StylistChat.jsx#L4980) | `outfitToSend && compareId` | `/ai/compare-outfits` | No |
| 3 | [4985](../src/components/StylistChat.jsx#L4985) | `outfitToSend?.imageGenerationMode` | `/ai/generate-saved-outfit-image` or `…-variants` | No — "Restyle" / "Find similar looks" |
| 4 | [5065](../src/components/StylistChat.jsx#L5065) | `outfitToSend` | `/ai/evaluate-wardrobe-outfit` | No |
| 5 | [5140](../src/components/StylistChat.jsx#L5140) | `pieceToSend && shouldGenerateEditorialVisuals` | `/ai/editorial-directions-preview` | Partly — regex on typed text |
| 6 | [5159](../src/components/StylistChat.jsx#L5159) | `pieceToSend && shouldGenerateOutfits` | `/ai/generate-outfits-for-piece` | No |
| 7 | [5185](../src/components/StylistChat.jsx#L5185) | `pieceToSend` | `/ai/evaluate-piece` | No |
| 8 | [5191](../src/components/StylistChat.jsx#L5191) | `shouldGenerateActiveEditorialVisuals` | `/ai/editorial-directions-preview` | **Yes** — regex only |
| 9 | [5210](../src/components/StylistChat.jsx#L5210) | `fileToSend` | `/ai/outfit-feedback` | **Yes** — attach a photo |
| 10 | [5221](../src/components/StylistChat.jsx#L5221) | `shouldUseOutfitCritiqueFollowup(q, threadMemory)` | `/ai/evaluate-wardrobe-outfit` (`responseMode:'followup'`) | **Yes** |
| 11 | [5262](../src/components/StylistChat.jsx#L5262) | generated-outfit memory + `OUTFIT_FOLLOWUP_PATTERN` | `/ai/ask` (+ `outfit`, `pieceIds`) | **Yes** |
| 12 | [5331](../src/components/StylistChat.jsx#L5331) | active outfit context / outfit memory + pattern | `/ai/ask` (+ outfit context) | **Yes** |
| 13 | [5410](../src/components/StylistChat.jsx#L5410) | *else* | `/ai/ask` | **Yes** — the ordinary path |

Branches 11, 12 and 13 all reach `/ask`, but with different bodies, and that difference changes what
`/ask` can do (Stage 3).

### Also decided here, before any request

- **The composer is cleared** — `setInput(''); setImageFile(null); setImagePrev(null)`
  ([:4887](../src/components/StylistChat.jsx#L4887)). The attached photo is consumed by exactly one
  turn; a second question about the same garment carries no image.
- **A new thread may be forced.** `forceNewFromExisting` splits off a fresh thread whenever a piece
  or outfit is attached inside an existing thread. The new thread gets a greeting and this message —
  **prior messages are never copied.**
- **The user message is persisted before the model is called**, via `saveThreadState`, so a failed
  turn still leaves the question in history.
- **`conversationMode` is classified client-side** by `classifyChatTurn`
  ([:551](../src/components/StylistChat.jsx#L551)) — a regex ladder returning `correction`,
  `explanation`, `preference_reaction`, `followup`, or `new_request`. Note the last rule:
  **any message in a thread that has memory becomes `followup`**, regardless of content.

---

## Stage 2 — Arrival at `/ask`, and the free exit

**`routes/ai.js`, [:3902](../routes/ai.js#L3902).**

The request body carries: `question`, `sessionId` (the thread id), `pieces` (the client's entire
wardrobe array), `history`, `conversationMode`, `threadContext`, `generatedContext`,
`generatedOutfits`, `activeContext`, styling context, and date context.

> `pieces` is the whole wardrobe, serialized on every turn. It is read in exactly one place —
> `makeGeneratedOutfitReferenceSheet(generatedOutfits, pieces || [])` — to resolve card thumbnails.
> Everything else the server needs it reads from SQLite itself.

**First: the free exit.** `detectExplicitProhibition(currentQuestion)` runs before anything else. A
self-contained prohibition ("never put me in ankle boots for summer") is stored locally by
`storeUserCorrection` and acknowledged with no model call at all, returning `isLocalAcknowledgment:
true` so the client suppresses follow-up affordances. This exists because a live thread once spent
five provider iterations to file one sentence.

**Then the turn's context object is built** — `toolContext`, which every tool mutates and which
becomes the turn's diagnostics record. Two of its fields are the retrieval contract:

```js
retrievedPieceIds: new Set(),     // what the model actually looked up
visuallySeenPieceIds: new Set(),  // what it actually saw a photo of
```

`diagnosticsContext` is hoisted immediately so a turn that throws mid-way still records what it
spent — a real turn once paid for a capsule roster call, died on the next call, and lost the
evidence entirely.

---

## Stage 3 — The execution router

**`routes/ai.js` [:3994–4172](../routes/ai.js#L3994).** This is the cost-control layer: one cheap
model call that decides whether the expensive one is needed at all.

### Eligibility

```js
const boundedRouterEligible = conversationMode === 'new_request'
  && !activeContext && !(pieceIds?.length)
const compactTurnHasContext = compactRouterTurnHasContext(conversationMode, compactContext)
const routerEligible = (boundedRouterEligible || compactRouterEligible)
  && !req.body.outfit && !req.body.image && !req.body.imageData
```

`compactRouterTurnHasContext` ([:755](../routes/ai.js#L755)) returns true for any `new_request`, and
otherwise only when the turn has a verified outfit set or a resolved piece subject. Its own comment
records the accepted miss: **a follow-up asking for general advice or an inventory count needs no
context, but is skipped anyway** — because paying for a router on every follow-up cost more than it
saved.

`compactFreeformContext` ([:719](../routes/ai.js#L719)) assembles the subject list, capped at 8
outfits and 16 piece ids, from server state first and the browser echo only as a legacy fallback.

### The routing call

`routeFreeformExecutionProfile` (provider.js [:1105](../styling-engine/provider.js#L1105)) is a
structured-output call, `maxTokens: 350`, against `FREEFORM_EXECUTION_ROUTER_SYSTEM`
([:1087](../styling-engine/provider.js#L1087)). It sees the question, the date, and a one-line
`contextSummary` — **never the wardrobe.** Its opening line says so explicitly.

### The six profiles

| Profile | Ends the turn as | Model calls |
|---|---|---|
| `wardrobe_inventory` | a SQL `GROUP BY category` table, `formatWardrobeInventoryAnswer` | 1 (router only) |
| `existing_card_explanation` | compact answer over the current card set | 2 |
| `garment_fact` | compact answer, plus saved photos via `compactGarmentVisualEvidence` | 2 |
| `general_advice` | compact answer, no wardrobe | 2 |
| `bounded_multi` | one atomic `generate_outfits` call, 2–5 looks | 1 + composer |
| `full_stylist` | falls through to Stage 4 | 1 + the whole loop |

Two guards sit on the compact exits:

- `compactProfileHasContext` ([:737](../routes/ai.js#L737)) — the chosen profile must actually have
  its subject. `general_advice` **returns true unconditionally**, since it needs nothing.
- `pieceScopeComplete` — for `garment_fact`, *every* requested id must resolve to an active row. A
  deleted or resting subject falls through to the full stylist rather than letting the compact model
  fill the gap.

`isSavedPhotoWearMechanicsQuestion` can override the router's choice to `garment_fact` when the
question is about how a garment sits and saved photos exist for the subject.

**On router failure**, the `catch` normally logs and falls through to the full stylist — except for
wear-mechanics questions, where it rethrows deliberately, so a cheap call that failed does not
silently become the most expensive path.

---

## Stage 4 — Composing the full-stylist prompt

**`buildStylistConversationPayload`, `styling-engine/core.js`
[:3877](../styling-engine/core.js#L3877).** Roughly 500 lines producing one object: `{ system,
messages, maxTokens: 1500, threadState, historyDiagnostics, wardrobeManifestIncluded }`.

### The wardrobe manifest

```js
activeManifestPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active' ORDER BY id").all()
```

`ORDER BY id` is load-bearing: deterministic ordering keeps the prompt prefix byte-stable, which is
what makes it cacheable. Above `WARDROBE_MANIFEST_MAX_PIECES` (default 400) the manifest is dropped
and the prompt falls back to tools-only guidance.

The manifest ships with its own rules of use, the important one being the **verification contract**:
the manifest is an index, not garment truth. Any piece named in an answer or placed in a card must be
verified *this turn* via `view_pieces`, `search_wardrobe`, or `get_garment_details` — and layer/base
pieces must additionally have been *seen*. This is mechanically enforced in Stage 6.

### The cache layout

```js
const system = prompts.STYLIST_SYSTEM + [
  'OCCASION & CLIMATE PROFILES (RULES-AS-DATA):', JSON.stringify(OCCASION_PROFILES, null, 2),
  'CURRENT WARDROBE TRUTH:', activeWardrobeText,
  PROMPT_CACHE_BREAKPOINT,          // ← everything above is stable and cached
  'CURRENT DATE / SEASON:', …
  'CONVERSATION CONTROLLER:', `Current turn mode: ${conversationMode}.`, …
  'THREAD STATE (STRUCTURED):', JSON.stringify(threadState, null, 1),
  threadContextText, extraContextText, attachedImageInventory,
  savedFeedbackSection, generatedOutfitContextText, …
].join('\n')
```

`systemToAnthropicBlocks` ([:907](../styling-engine/provider.js#L907)) splits on the marker and puts
`cache_control: {type:'ephemeral', ttl:'1h'}` on the stable block — moved from the default 5-minute
TTL 2026-08-21, since the block only changes when the wardrobe itself changes and idles across an
ordinary chat cadence far more often than it sits within 5 minutes. `withMovingCacheBreakpoint`
([:926](../styling-engine/provider.js#L926)) puts a second one, on the *default* 5-minute TTL, on the
last block of the last message, so growth within the tool loop is also cached — Anthropic requires a
longer-TTL breakpoint to precede any shorter one in the same request, which this ordering already
satisfies. **Two of Anthropic's four breakpoints are in use.**

Anthropic's cached prefix is ordered **tools → system → messages**. The tool schemas sit *ahead* of
the system block, so a single varying byte in a tool description invalidates the whole prefix. This
is why `stylistToolsForTurn` ([:757](../styling-engine/provider.js#L757)) returns byte-identical
schemas for every turn mode, and why its comment forbids putting per-turn policy back there.
Per-turn behaviour belongs *below* the breakpoint, in the conversation controller.

### Everything below the breakpoint

`conversationMode` and its directive; the date; `freeformToolRoutingInstruction(conversationMode)`;
weather context and the travel-weather blocker; **`THREAD STATE`**, declared as "the single source of
truth for established styling context and the current outfit set", winning over older prose; thread
context; the attached-image inventory; saved feedback and owner guidance
(`SAVED STYLIST FEEDBACK & PREFERENCES (HIGH-AUTHORITY MEMORIES)`); and the current generated-card
context.

### The messages

```js
const priorHistory = (history || []).map(h => ({ role: h.role, content: h.content }))
if (askedNow && last?.role === 'user' && last.content.trim() === askedNow) priorHistory.pop()
const boundedHistory = boundFreeformConversationHistory(priorHistory)
return { messages: [...boundedHistory.messages, { role: 'user', content: userContent }] }
```

The `pop()` exists because the client appends the question to `chatHistory` *and* sends it as
`question`, so it used to reach the model twice on every turn.

`boundFreeformConversationHistory` ([:32](../styling-engine/core.js#L32)) keeps the newest **8**
messages, **12,000** chars total, **3,500** per message, trims from the oldest, and shifts until the
window starts on a user turn. It reads `String(message.content ?? '')` — history is text. **Any
image in an earlier turn is gone by turn two**, which is Stage 9's first discontinuity.

---

## Stage 5 — The tool loop

**`askStylistWithTools`, `styling-engine/provider.js`
[:1212](../styling-engine/provider.js#L1212).** Up to **10** iterations (the comment records that the
disciplined flow — declare, search, view supports, view layers, propose ×N — legitimately needs 6–8,
and a cap of 7 killed live turns with zero cards).

Each iteration:

1. `systemToAnthropicBlocks(system)` + `withMovingCacheBreakpoint(currentMessages)`, with
   `stylistToolsForTurn(toolContext)` — the 14 tools of `STYLIST_TOOLS`
   ([tools.js:566](../styling-engine/tools.js#L566)): `declare_intent`, `search_wardrobe`,
   `view_pieces`, `suggest_slot_swaps`, `render_preview`, `wardrobe_coverage`,
   `get_garment_details`, `get_last_outfit_evaluation`, `get_current_image_inventory`,
   `store_user_correction`, `generate_outfits`, `plan_outfit_set`, `submit_plan_outfits`,
   `propose_outfit`.
2. Usage is recorded per iteration (`recordToolLoopUsage`), including cache read/write splits.
3. If `stop_reason === 'tool_use'`: prose written *alongside* the tool calls is collected into
   `narration` — it is part of the answer, and discarding it once shipped a reply that was a bare
   `---` followed by notes about looks that had been thrown away. Tools execute; results return as
   `tool_result` blocks, with any images appended as base64 blocks under an instruction to judge by
   sight.
4. Otherwise the loop exits to the guards.

`stylistToolsForTurn` returns `[]` — ending the turn — once an atomic composer has completed
(`atomicMultiLookCompleted`, `capsuleAtomicCompleted`, `slotSwapCompleted`). Offering no tools is the
deliberate turn-ending boundary.

---

## Stage 6 — The output guards

**`applyFreeformOutputChecks`, [:132](../styling-engine/provider.js#L132).** These run on the final
text, **before** citations are stripped. First failing clause wins; **each clause gets exactly one
retry** (`retriedChecks`), and a retry *replaces* the answer — `supersedeNarrationOnRetry` clears
accumulated prose so a rejected claim is not shipped alongside its own correction.

| Clause | Fires when |
|---|---|
| `zeroResultContradiction` | prose contradicts a search that returned nothing |
| `unverifiedCitation` | a cited piece id was never retrieved this turn |
| `cardProseInconsistent` | a card's own words don't describe the card |
| `destinationClarification` | travel request missing destination (retire candidate) |
| `cardsNotDelivered` | declared cards, delivered none, asked nothing |
| `imageNotDelivered` | declared `want:'image'`, never called `render_preview` |
| `outfitCount` | asked for N cards, produced fewer |
| `outfitProse` | prose describes an outfit that never went through `propose_outfit` |

Then, in order:

1. `applyAcceptedCardAuthority` ([:310](../styling-engine/provider.js#L310)) — accepted cards
   outrank the closing prose.
2. `discloseUnresolvedFreeformChecks` ([:1191](../styling-engine/provider.js#L1191)) — re-runs the
   predicates and **tells the user** what is still failing after the retry, rather than silently
   shipping it.
3. `stripPieceIdCitations` ([:289](../styling-engine/provider.js#L289)) — at the response boundary in
   `routes/ai.js`, so every guard that needed the `(ID 196)` citations already ran on text that still
   had them.

---

## Stage 7 — The response, and what the client does with it

Every `/ask` exit returns the same envelope, so the client cannot tell which of the six paths
produced it:

```js
{ answer, savedCorrections, renderedBoards, provider,
  structuredOutfits, structuredOutfitsSource, structuredOutfitsOccasion, …,
  debug, suggestedTitle, isLocalAcknowledgment? }
```

**Server-side persistence:** `persistFreeformGenerationRun` writes one row to
`freeform_generation_runs` — iterations, token counts and cache splits, gate exclusions, propose
validation failures, history diagnostics, and `turn_failed`. It runs on **both** the success and the
error path, and swallows its own errors so it can never turn a provider failure into a 500.

> **Gap.** `executionProfile` is set on the diagnostics object
> ([4044](../routes/ai.js#L4044), [4101](../routes/ai.js#L4101)) but is **not a column** in
> `freeform_generation_runs`. It reaches the browser in `debug` and is stored in the thread payload,
> so a misroute is recoverable from the thread — but it is invisible to any query over the
> diagnostics table. It is also only ever set on the two branches that *take*: a turn that fell
> through to the full stylist records no profile at all.

**Client-side:** an `assistantMsg` is assembled with the text plus every structured field, and the
whole conversation is `POST`ed to `/api/chat-threads` as a JSON `payload` — `messages`,
`chatHistory`, `boardResults`, `threadMemory`, `activeContext`, `evaluatedKeys`,
`editorialVisualResults`, `evaluationResultsByKey`. **The thread is one JSON blob**, not rows.

`threadMemory` is the client's own summary of the turn (`type: 'generated_outfits' | 'outfit' |
'generated_outfit'`, latest cards, latest evaluation text, styling context). It is what the *next*
turn's dispatcher reads.

---

## Stage 8 — The follow-up turn

The second message runs the same code with three inputs changed:

1. **`conversationMode` is almost certainly `followup`** — `classifyChatTurn`'s last rule returns
   `followup` for *any* text once `hasThreadMemory` is true.
2. **`threadMemory` now exists**, so dispatcher branches 10–12 are live. A question matching
   `OUTFIT_FOLLOWUP_PATTERN` no longer reaches the ordinary `/ask` branch.
3. **`history` is populated**, and gets bounded to the last 8 messages / 12k chars.

Consequences worth stating plainly:

- `followup` + no verified card or piece subject ⇒ `compactRouterTurnHasContext` is false ⇒ **the
  router is skipped and the turn goes straight to the full stylist**, with a
  `compactRouterSkippedNoContext` diagnostic. The cheap paths are unreachable.
- The server reloads its own `threadState` via `getStylistConversationState(sessionId)`, and
  `THREAD STATE` is declared to win over prose. Server state, not the browser echo, is authority.
- History is text only. Images, cards, and tool results from earlier turns do not survive; only what
  was written into `threadContext` / `generatedContext` / `threadState` carries forward.

---

## Stage 9 — The discontinuities

These are not bugs found by inspection; each one is visible in a live thread. They are collected
here because no per-flow document can show them — they exist *between* flows.

**1. An attached photo permanently changes the feature — partially fixed 2026-08-20.**
Branch 9 sends the turn to `/outfit-feedback`, which has no tools, no `search_wardrobe`, no verified
piece ids, and cannot produce a card. It used to compensate by pasting **every active piece** into
the prompt as text — measured at **79,766 tokens**, the most expensive single call in the app, pure
text with no visual-grounding tradeoff, and premised on an ownership assumption the uploaded-photo
case does not have (see [unfiled-garment-spec.md](unfiled-garment-spec.md)). That dump is gone
(`routes/ai.js`'s `/outfit-feedback` handler no longer queries the wardrobe at all).

The blindness half is also fixed: the composer still clears `imageFile` after one turn, but
`messages[].uploadedPhoto` persists client-side and `/ask`'s default branch now resends the thread's
most recent one as `uploadedPhoto`, which `buildStylistConversationPayload` reattaches as an image at
the volatile tail (see [flows/outfit-evaluation.md](flows/outfit-evaluation.md)). History itself is
still text-only — the image is resent by filename, not replayed from history — so turn two about the
same garment can see it again, with a note that it has no linked pieces and ownership questions need
`search_wardrobe`, not a guess from the picture.

**2. The same question costs 20× depending on the sentence before it.**
"What should I wear tomorrow?" as a first message is `new_request` ⇒ router ⇒ possibly
`bounded_multi`. The same sentence as message four is `followup` with no card subject ⇒ router
skipped ⇒ full stylist, manifest and all.

**3. Once outfit memory exists, the ordinary path is nearly unreachable.**

```js
const OUTFIT_FOLLOWUP_PATTERN = /\b(this|it|outfit|idea|look|piece|pieces|make|change|swap|instead|
  sharper|stronger|softer|better|work|works|risk|risky|why|how|what)\b/i
```

That matches `this`, `it`, `what`, `why`, `how`, `work` — almost any English sentence. In a thread
with outfit memory, branches 11 and 12 capture nearly everything typed, so branch 13 (plain `/ask`)
is effectively dead for the rest of the thread. The user is silently locked into outfit-continuation
semantics by their first click.

**4. A regex can hijack a typed question.**
`editorialRequestPattern` contains `not.*wardrobe`. With a piece active, *"is this not in my
wardrobe?"* is routed to editorial image generation (branch 8) instead of being answered.

**5. The router cannot see the wardrobe it is routing for.**
By design — it is cheap because it sees only the question and a one-line context summary. The cost is
that "do I own a tank top that works here?" reads as an inventory question and can be answered with a
`GROUP BY category` table that answers nothing the user asked.

**6. Attaching a piece silently forks the thread.**
`forceNewFromExisting` starts a new thread with a greeting and the new message. Prior messages are
never copied, so the context the user was building is gone — and this is why the chat-upload
retention rule in `routes/crud.js` needs no cross-thread guard: no second thread can ever cite the
same upload.

**7. A misroute leaves a thin trail.**
`executionProfile` is not persisted to the diagnostics table (Stage 7), and is never set at all on
the full-stylist fall-through. Reconstructing a bad turn means reading the thread payload's `debug`
blob.

---

## What this document does not cover

| Topic | Owner |
|---|---|
| Inside `/ask`'s architecture, spec by spec | [flows/freeform-stylist-chat.md](flows/freeform-stylist-chat.md), [freeform-rearchitecture-handoff.md](freeform-rearchitecture-handoff.md) |
| Outfit evaluation internals | [flows/outfit-evaluation.md](flows/outfit-evaluation.md) |
| Selected-piece composer, boards, renders | [flows/selected-piece-composer.md](flows/selected-piece-composer.md), [flows/piece-concept-boards.md](flows/piece-concept-boards.md), [flows/outfit-image-renders.md](flows/outfit-image-renders.md) |
| Gates, scores, caches | [engine-behaviour-map.md](engine-behaviour-map.md) |
| Who reads a memory back, and with what authority | [feedback-and-memory-map.md](feedback-and-memory-map.md) |
| Where the tokens sit, and the levers left | [freeform-prompt-cache-levers.md](freeform-prompt-cache-levers.md), [search-payload-spec.md](search-payload-spec.md) |
| `/expand-capsule`, `/repair-capsule-look` | **Nothing.** No diagram exists; the gap is now recorded in flows/README |
