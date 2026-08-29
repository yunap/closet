# Spec — a prose-only stylist answer leaves no continuity for the next turn

**Status:** proposed, not implemented — the three open questions from the first draft are now
answered (§7); one of them (the piece-id cap) changes the design in §5.2 from what was first
proposed.
**Route:** [docs/README.md](README.md). Sources this spec must not restate:
[architecture-responsibility-census.md](architecture-responsibility-census.md) (the ownership model
this fix must align to), [message-lifecycle.md](message-lifecycle.md) (the router and its six
profiles), [feedback-and-memory-map.md](feedback-and-memory-map.md) (persisted stores and their
authority).

---

## 1. The defect

Diagnosed live, `thread_1788045797471`:

1. Turn 1: *"Do I have anything appropriate for a chilly work dinner tonight? Show me tops/bottoms/
   shoes/outerwear."* → routed to `full_stylist`, called `search_wardrobe`, answered in prose
   naming specific pieces (olive-gold silk blouse, black turtleneck, ...). No cards.
2. Turn 2: *"yes, put together three complete outfits"* → the small execution router classified
   this as `bounded_multi` and invoked `generate_outfits`, which built a fresh Visual Composer
   roster **from scratch**. The three resulting outfits used none of the pieces turn 1 had just
   named.
3. Turn 3: the user caught it — *"hmm, looks like you have not used any of the pieces you talked
   about earlier"* — and the model apologized and rebuilt the outfits correctly via `view_pieces`/
   `propose_outfit`, at a real cost: 9 iterations, $0.215, one hard-gate validation failure and
   retry.

This is not a one-off classifier miss. It reproduces on any turn shaped
`[coverage/discovery question]` → `"yes, do it"`, because the cause is structural, not a bad
regex.

## 2. Root cause — three parallel "did we just talk about pieces" mechanisms, all gated the same way

Traced end to end. There are three places that could tell the system a prior turn established
specific pieces, and **all three are populated only by an outfit-producing turn** — none of them by
a prose-only wardrobe answer, even one that named and reasoned about specific pieces:

1. **Client `threadMemory`** ([StylistChat.jsx:5563](../src/components/StylistChat.jsx#L5563)) —
   `setThreadMemory(...)` fires only `if (replyStructuredOutfits.length)`. A coverage answer never
   sets it, so it stays `null` into the next turn.
2. **Client's own follow-up classifier** ([StylistChat.jsx:552](../src/components/StylistChat.jsx#L552))
   — `classifyChatTurn` returns `'followup'` only via an explicit word match (`last/previous/
   earlier/that one/...`) or via `hasThreadMemory`, which is `Boolean(threadMemory || activeContext)`
   — both `null` here. *"yes, put together three complete outfits"* contains none of the trigger
   words, so it falls through to `'new_request'` — a plainly wrong label for a direct continuation,
   but correct given what the function was told.
3. **Server `stylist_conversation_state`** ([styling-engine/conversationState.js](../styling-engine/conversationState.js))
   — a genuine per-session, server-authoritative persisted table, already read by
   `compactFreeformContext` and explicitly documented as authoritative over the client's echo
   (`routes/ai.js:868`: *"Server state is the verified authority. The browser echo remains a legacy
   fallback"*). There are in fact **two** writers (corrected after checking — the first draft of
   this spec found only one), and between them they still miss this case:
   - [routes/ai.js:4822](../routes/ai.js#L4822), gated on `toolContext.atomicMultiLookCompleted` —
     only after a successful `bounded_multi` turn.
   - [styling-engine/core.js:4505](../styling-engine/core.js#L4505), inside
     `buildStylistConversationPayload` — called once per `full_stylist` turn, but **before the tool
     loop runs**, since it is part of prompt assembly. It persists only `established` (scalar
     context) and `current_outfit_set` (restored from the previous turn or echoed from the body). It
     structurally cannot capture what *this* turn's `search_wardrobe`/`view_pieces` calls verify,
     because those calls have not happened yet when it runs.

   So turn 1's `search_wardrobe` result never reaches `stylist_conversation_state` — not because no
   writer ran, but because the one writer that ran for that turn (`core.js:4505`) fires too early to
   see it, and the other writer never fires at all outside `bounded_multi`.

Given all three are `null`/empty, `boundedRouterEligible` ([routes/ai.js:4649](../routes/ai.js#L4649))
— `conversationMode === 'new_request' && !activeContext && !pieceIds.length` — passes cleanly, and
`routeFreeformExecutionProfile` is asked to classify turn 2 with a `contextSummary` that has nothing
to summarize. It correctly (in isolation) reads *"put together three complete outfits"* as an
ordinary `bounded_multi` ask. The router did its job; it was never given the evidence to do it
right.

**A second, smaller inconsistency, found while tracing this:** `boundedRouterEligible` at
`routes/ai.js:4649` reads the raw `req.body.pieceIds` directly, while `contextSummary` and the
compact profiles a few lines later read `compactContext.pieceIds` — the *merged, server-authoritative*
list `compactFreeformContext` already builds from server state, body, and named pieces. These two
checks can already disagree today: a turn can be `boundedRouterEligible` (raw body field empty)
while `compactContext.pieceIds.length > 0` (server state has a real subject) at the same time. That
is exactly architecture-responsibility-census.md §1's second failure pattern: *"missing context is
resolved differently before the same shared gate runs."*

## 3. Why the cheap fix is wrong

The cheap fix is a client-side patch: teach `classifyChatTurn` a fourth `hasThreadMemory` source
(e.g. "the previous assistant message named specific garments"), or set `threadMemory` after a
prose answer too. That would resolve this one incident but adds a **fourth** independent
continuity mechanism next to the three that already disagree, in the one layer
(architecture-responsibility-census.md §1) explicitly named as the recurring risk here: *"a new or
legacy adapter can still recreate a semantic decision outside the shared interface."* A regex
heuristic living only in the browser cannot be the authority for whether the router — a
server-side, cost-control decision — has enough context; it would just move the disagreement
somewhere else instead of resolving it.

## 4. What already exists to build on — the canonical stage, not a new one

The full tool loop already has the exact record this needs, and it already has a name:
`verifiedPieceIdSets(toolContext)` ([styling-engine/tools.js:1015](../styling-engine/tools.js#L1015)),
built from `recordRetrievedPieces` ([styling-engine/tools.js:1003](../styling-engine/tools.js#L1003)).
This is the same mechanism `message-lifecycle.md`'s verification contract already relies on — *"Any
piece named in an answer or placed in a card must be verified this turn via `view_pieces`,
`search_wardrobe`, or `get_garment_details`."* Turn 1's `search_wardrobe` call already populated
`toolContext.retrievedPieceIds` with exactly the pieces it surfaced. That data exists; it is simply
discarded the moment the turn ends without producing a card.

`stylist_conversation_state` is the canonical server-side persistence stage for this class of fact
— `compactFreeformContext` already prefers it over the client echo. It just has one writer, gated
too narrowly.

## 5. Design — extend the two existing canonical stages, add no new one

**5.1 — Persist verified-piece evidence from every `full_stylist` turn, not only `bounded_multi`, at
a point that can actually see it.**

`core.js:4505` cannot carry this (§2: it runs before the tool loop). The write has to happen where
`bounded_multi`'s already does — after the turn's tool calls complete, at `full_stylist`'s answer
branch in `routes/ai.js` (the one that returns `answer: stripPieceIdCitations(answerCall.text)`
without a `generate_outfits` call) — with a new field alongside the existing `current_outfit_set`:

```js
recently_verified_pieces: {
  piece_ids: [...verifiedPieceIdSets(toolContext).retrieved].slice(0, RECENT_VERIFIED_CAP),
  seen_piece_ids: [...verifiedPieceIdSets(toolContext).seen],
  turn_token: freeformTurnToken,
}
```

**This write must not be silently erased by the other writer.** `saveStylistConversationState`
replaces the entire `state_json` blob — it is not a partial merge (`conversationState.js:14`
does `INSERT ... ON CONFLICT DO UPDATE SET state_json = excluded.state_json`, the whole value). Since
`core.js:4505` fires unconditionally at the *start* of every subsequent `full_stylist` turn and only
knows about `established`/`current_outfit_set`, it would silently wipe `recently_verified_pieces`
one turn after this write, exactly the same way a `new_request`-classified turn already drops
`current_outfit_set` today (`core.js:4472-4474`). `core.js:4505` must be updated to read the incoming
`restoredState.recently_verified_pieces` and carry it forward in its own write, the same pattern
`current_outfit_set` already uses for its own restore-vs-drop decision. Both writers need to agree
on this field's shape, not just the new one.

**5.2 — Do NOT fold it into `compactFreeformContext`'s merged `pieceIds` list. Keep it a separate,
purpose-scoped field.**

The first draft of this spec proposed merging `recently_verified_pieces` straight into
`compactContext.pieceIds`, the same list `compactFreeformContext` already builds. Checking the
downstream consumers of that exact list changes this: at `routes/ai.js:4732`,
`compactContext.pieceIds` is used as a **direct subject-resolution fallback** for `garment_fact`
when a vague reference ("these shorts") can't be resolved any other way — and that fallback already
has a named, documented failure mode in the code's own comment (`thread_1787435527800 msg 16/17`:
an unresolved vague reference falling back to *every* piece in the accumulated current-card set).
Merging in up to `RECENT_VERIFIED_CAP` more ids from a `search_wardrobe` call — which can include
broadened/relaxed matches per the relaxation ladder, not just tightly-relevant ones — would widen
that exact failure surface, not just fix router eligibility.

Instead: keep `recently_verified_pieces` as its own field, read directly (not merged into
`compactContext.pieceIds`) by exactly the two consumers this spec targets — the router-eligibility
check (§5.3) and the `contextSummary` hint text — and by nothing that does direct ID-scoped subject
resolution.

**5.3 — Fix `boundedRouterEligible` to also check for verified-piece evidence, read directly, not
merged.**

Replace the check at `routes/ai.js:4649` — `!(Array.isArray(req.body.pieceIds) && req.body.pieceIds.length)`
— with a check against `compactContext.pieceIds.length` (still fixing the found inconsistency in §2:
raw body field vs. merged server state) **and** `state.recently_verified_pieces?.piece_ids?.length`
(the new field from §5.1, read directly). Either one being non-empty should make
`boundedRouterEligible` false. This is what actually keeps turn 2 out of the `bounded_multi` fast
path: `recently_verified_pieces` would now be non-empty from turn 1's search, so the turn correctly
falls through toward `full_stylist` — and if compact profiles are still reachable, `contextSummary`
can independently mention "verified garment subjects available" from this field too, without ever
routing it through the noise-sensitive `pieceIds` list from §5.2.

**5.4 — Thread the same evidence into eligibility as a soft anchor, not a hard override, when
`bounded_multi` does run.**

Per architecture-responsibility-census.md, piece eligibility is canonically owned by
`evaluateAutomaticUsePiecePool`, and "Anchor Piece" bias is already a named, existing concept there
for selected-piece flows (§3, row 1: *"visual policy with the anchor protected"*). When
`recently_verified_pieces` is present and `bounded_multi` still fires (e.g. the user pivots to a
genuinely new context), pass those piece ids into `generate_outfits`'s candidate resolution as a
**soft bias** through the same anchor mechanism — not a hard requirement that they appear, since
the user may have moved on. This keeps the fix inside the existing eligibility-pool contract rather
than adding a bounded_multi-only parameter that only this one call site understands.

## 6. What this does not change

- The router's own architecture (question + date + one-line `contextSummary`, never the wardrobe)
  is unchanged — it still never sees garment truth, only richer evidence of *whether* a subject
  exists, which is exactly the class of fact it already consumes for `garment_fact`/
  `existing_card_explanation`.
- `full_stylist` turns that never call a retrieval tool (`general_advice`,
  `wardrobe_inventory`-shaped prose) write nothing new — `verifiedPieceIdSets` would be empty for
  them, so `recently_verified_pieces` is simply absent, same as today.
- No change to `search_wardrobe`'s own behavior, the visual budget cap (#272), or EXIF handling
  (#273) — unrelated surfaces.

## 7. Open questions — checked, answered

1. **Expiry — checked.** `current_outfit_set` has no soft-expiry rule; the existing model is a hard
   "whichever turn's writer runs last, wins" full-blob-replace (`conversationState.js:14`), gated on
   `conversationMode`, not time or turn count (`core.js:4472-4474`). There is no decay precedent to
   copy — but checking this surfaced a sharper problem than "what's the expiry policy": **a
   `new_request`-misclassified `full_stylist` turn doesn't just fail to use restored
   `current_outfit_set`, it actively overwrites the stored row and erases it for every turn after**,
   because `core.js:4505` unconditionally persists whatever it just computed (empty, in the
   misclassified case). §5.1's fix for `recently_verified_pieces` has to avoid the same trap — see
   the "must not be silently erased" requirement added to §5.1 above. Resolution: no expiry field
   needed; "superseded by the next writer, and both writers must agree on the field's shape" is
   sufficient and consistent with how the table already works — but only once §5.1's cross-writer
   fix lands, otherwise this field would suffer the exact bug it's meant to fix.
2. **Which retrieval tools count — checked, no gap.** `recordRetrievedPieces` is already called by
   every retrieval-shaped tool: `search_wardrobe` (`tools.js:1475-76`), `view_pieces`
   (`tools.js:1927-28`), `get_garment_details` (`tools.js:2335-36`), and `suggest_slot_swaps`
   (`tools.js:2144`). `verifiedPieceIdSets(toolContext)` already aggregates all of them correctly.
   No new call site needed — §5.1 can read this helper as-is.
3. **Cap of 16 — checked, this changes the design.** `compactFreeformContext`'s merged `pieceIds`
   list is not just a "does context exist" signal — `routes/ai.js:4732` uses it directly as
   `garment_fact`'s vague-reference subject-resolution fallback, a path with an existing documented
   failure mode (`thread_1787435527800`: an unresolved vague reference resolving against the entire
   accumulated set instead of the one piece meant). Folding `recently_verified_pieces` into that same
   list — the original §5.2 proposal — would widen exactly that failure surface with
   `search_wardrobe` results that can include relaxed/broadened matches, not just tight ones. Revised
   design in §5.2 above: `recently_verified_pieces` stays a separate field with its own cap
   (`RECENT_VERIFIED_CAP`, tentatively 8 — half of `compactFreeformContext`'s existing 16, since this
   is router-eligibility evidence, not a resolvable-subject list, and doesn't need the same headroom),
   read directly by the router-eligibility check and `contextSummary`, never merged into the list
   `garment_fact` resolves subjects against.
