# Spec — a prose-only stylist answer leaves no continuity for the next turn

**Status:** proposed, not implemented — revised after external review (see §8 for what changed and
why). The design now differs from the first draft in three ways: the persisted field holds pieces
actually *discussed* in the answer, not raw search candidates; the router is informed rather than
deterministically gated; and the soft-anchor bias into `bounded_multi` (originally §5.4) is dropped.
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
   fallback"*). There are in fact **two** writers, and between them they still miss this case:
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

Given all three are `null`/empty, the execution router (which does run for this turn — see §5.3) is
asked to classify turn 2 with a `contextSummary` that has nothing to summarize. It correctly (in
isolation) reads *"put together three complete outfits"* as an ordinary `bounded_multi` ask. The
router did its job; it was never given the evidence to do it right.

**A second, smaller, independent inconsistency, found while tracing this:** `boundedRouterEligible`
at `routes/ai.js:4649` reads the raw `req.body.pieceIds` directly, while `contextSummary` and the
compact profiles a few lines later read `compactContext.pieceIds` — the *merged, server-authoritative*
list `compactFreeformContext` already builds from server state, body, and named pieces. These two
checks can already disagree today: a turn can be `boundedRouterEligible` (raw body field empty)
while `compactContext.pieceIds.length > 0` (server state has a real subject) at the same time. That
is exactly architecture-responsibility-census.md §1's second failure pattern: *"missing context is
resolved differently before the same shared gate runs."* **This is worth fixing on its own merits,
but it is not part of the causal chain for this incident** (§5.3 explains why) — tracked as
independent cleanup, not bundled into the behavioral fix below.

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

The full tool loop already has records this needs, and they already have names:

- `verifiedPieceIdSets(toolContext)` ([styling-engine/tools.js:1015](../styling-engine/tools.js#L1015)),
  built from `recordRetrievedPieces` ([styling-engine/tools.js:1003](../styling-engine/tools.js#L1003)).
  This is the same mechanism `message-lifecycle.md`'s verification contract already relies on —
  *"Any piece named in an answer or placed in a card must be verified this turn via `view_pieces`,
  `search_wardrobe`, or `get_garment_details`."*
- `extractPieceIdsFromProse(answerText)` ([styling-engine/provider.js:115](../styling-engine/provider.js#L115))
  — already extracts the piece IDs a model's answer actually cited, before
  `stripPieceIdCitations` scrubs them for display. `applyFreeformOutputChecks`'s truth clause
  ([styling-engine/provider.js:156](../styling-engine/provider.js#L156)) already computes
  `citedIds = extractPieceIdsFromProse(answerText)` and intersects it against
  `verifiedPieceIdSets(toolContext)` to enforce that every citation was actually verified this
  turn. **This intersection — cited AND verified — is exactly the set of pieces the user would
  reasonably call "the ones we just talked about,"** and it is already computed, at the exact point
  in the code where this spec's write needs to happen.

`retrievedPieceIds` alone (what the first draft of this spec proposed persisting) is the wrong
signal: `search_wardrobe` can return considerably more than what the assistant's prose actually
discusses — broadened/relaxed matches per the relaxation ladder, or candidates surfaced but not
mentioned. Persisting the first N of those risks the same shape of bug this spec exists to fix: the
next turn "continues" with pieces the user never actually saw discussed.

`stylist_conversation_state` is the canonical server-side persistence stage for this class of fact
— `compactFreeformContext` already prefers it over the client echo. It just has no writer that
captures this fact today.

## 5. Design — extend the two existing canonical stages, inform the router, don't gate it

**5.1 — Persist *discussed*, not *retrieved*, piece evidence, from every `full_stylist` turn.**

At the point `full_stylist` accepts its final answer — where `applyFreeformOutputChecks` already
computes `citedIds` and cross-checks it against `verifiedPieceIdSets(toolContext)` — capture the
same intersection as a new field, alongside the existing `current_outfit_set`, the same place
`bounded_multi`'s writer already runs (`routes/ai.js`, the branch that returns
`answer: stripPieceIdCitations(answerCall.text)`):

```js
const { retrieved, known } = verifiedPieceIdSets(toolContext)
const citedIds = extractPieceIdsFromProse(answerText)
const discussedIds = citedIds.filter(id => retrieved.has(id) || known.has(id))

recently_discussed_piece_ids: {
  piece_ids: discussedIds.slice(0, RECENTLY_DISCUSSED_CAP), // generous cap (e.g. 16) — this set is
                                                              // already precise, not a raw candidate
                                                              // dump, so the cap is a safety bound,
                                                              // not a selection rule
  turn_token: freeformTurnToken,
}
```

If the answer discussed six garments out of a 24-piece search result, this persists those six — not
an arbitrary insertion-order slice of the 24.

**This write must not be silently erased by the other writer.** `saveStylistConversationState`
replaces the entire `state_json` blob — it is not a partial merge (`conversationState.js:14`
does `INSERT ... ON CONFLICT DO UPDATE SET state_json = excluded.state_json`, the whole value). Since
`core.js:4505` fires unconditionally at the *start* of every subsequent `full_stylist` turn and only
knows about `established`/`current_outfit_set`, it would silently wipe `recently_discussed_piece_ids`
one turn after this write, exactly the same way a `new_request`-classified turn already drops
`current_outfit_set` today (`core.js:4472-4474`). `core.js:4505` must be updated to read the incoming
`restoredState.recently_discussed_piece_ids` and carry it forward in its own write. Both writers
need to agree on this field's shape, not just the new one.

**5.2 — Do NOT fold it into `compactFreeformContext`'s merged `pieceIds` list. Keep it a separate,
purpose-scoped field.**

At `routes/ai.js:4732`, `compactContext.pieceIds` is used as a **direct subject-resolution
fallback** for `garment_fact` when a vague reference ("these shorts") can't be resolved any other
way — and that fallback already has a named, documented failure mode in the code's own comment
(`thread_1787435527800 msg 16/17`: an unresolved vague reference falling back to *every* piece in
the accumulated current-card set). Even with the more precise `discussedIds` set from §5.1, merging
it into that list would widen the scope `garment_fact` resolves an ambiguous reference against in a
way that field was never designed for.

Instead: `recently_discussed_piece_ids` stays its own field, read directly by exactly one consumer
— the router's `contextSummary` (§5.3) — and by nothing that does direct ID-scoped subject
resolution.

**5.3 — Inform the router; do not gate it.**

The first draft of this spec proposed making `boundedRouterEligible` (`routes/ai.js:4649`) false
whenever recent-piece evidence exists — a deterministic veto forcing every such turn through
`full_stylist`. **This is wrong and has been dropped**, for two reasons found on review:

1. **It is unreachable-in-practice as a fix, and unnecessary.** `boundedRouterEligible` doesn't
   bias which profile the router picks — it gates whether the router is *invoked at all*
   (`routerEligible = (boundedRouterEligible || compactRouterEligible) && ...`; false skips the
   router and falls straight to `full_stylist`). But `compactRouterTurnHasContext`
   (`routes/ai.js:902`) already returns `true` unconditionally whenever
   `conversationMode === 'new_request'` — exactly turn 2's classification. So the router was
   *already* going to run for this turn; `boundedRouterEligible` never needed to change to fix this
   incident.
2. **It is wrong product behavior anyway.** Consider: *"Do I have jackets suitable for a work
   dinner?"* → discussion → *"Actually, forget that — give me three outfits for hiking tomorrow."*
   The existence of the prior turn's jacket evidence must not make `bounded_multi` categorically
   unavailable for a request that is plainly unrelated to it. A hard code-level veto can't tell
   those two cases apart; the router — a model making exactly this kind of judgment call for every
   other profile already — can.

The actual fix: extend the `contextSummary` string already built at `routes/ai.js:4680` (which
today says things like *"no verified garment subject"* / *"verified current outfit set: N
card(s)"*) with the new fact:

```js
recentlyDiscussedPieces.length
  ? `previous answer discussed ${recentlyDiscussedPieces.length} specific verified wardrobe piece(s)`
  : 'no recently discussed wardrobe pieces'
```

The router then makes the same kind of continuation-vs-fresh-request judgment it already makes for
every other profile, now with a true fact to reason from instead of nothing. This preserves the
existing division of labor exactly: code supplies truthful context, the model judges conversational
intent.

The independent `req.body.pieceIds`-vs-`compactContext.pieceIds` inconsistency (§2) should still be
fixed, but as its own change — it affects `boundedRouterEligible`'s correctness in general, not this
incident specifically, and bundling it with a behavioral change this spec explicitly rejects (a
router-invocation gate) would blur why each change exists.

## 6. What this does not change

- The router's own architecture (question + date + one-line `contextSummary`, never the wardrobe)
  is unchanged — it still never sees garment truth, only richer evidence of *whether* a subject
  exists, which is exactly the class of fact it already consumes for `garment_fact`/
  `existing_card_explanation`. The router's judgment is still the deciding factor, not a code-level
  gate.
- `bounded_multi`'s own candidate resolution (`generate_outfits` → the Visual Composer) is
  unchanged. An earlier draft of this spec (§5.4, now removed — see §8) proposed biasing its
  candidate pool toward recently-discussed pieces as a soft anchor whenever `bounded_multi` still
  fired. Dropped: once routing correctly sends continuations to `full_stylist` (where the discussed
  pieces can be restored and composed from directly) and correctly leaves unrelated fresh requests
  on `bounded_multi` untouched, there is no remaining case where biasing the composer's own pool
  earns its complexity — it would only reintroduce a version of the stale-context risk this spec
  exists to remove.
- `full_stylist` turns that never call a retrieval tool (`general_advice`,
  `wardrobe_inventory`-shaped prose) write nothing new — `citedIds`/`discussedIds` would be empty
  for them, so `recently_discussed_piece_ids` is simply absent, same as today.
- No change to `search_wardrobe`'s own behavior, the visual budget cap (#272), or EXIF handling
  (#273) — unrelated surfaces.

## 7. Acceptance criteria

Two live-shaped test cases, both required — one alone would let a future change reintroduce exactly
the bug just rejected in §5.3:

1. **Continuation case (the original incident).** Reproduce the two-turn sequence: a `full_stylist`
   coverage answer naming specific pieces, followed by *"yes, put together three complete
   outfits."* Assert:
   - the execution router is still invoked for turn 2 (not skipped — guards against a future
     "fix" that reintroduces a hard `boundedRouterEligible` veto instead of informing the router);
   - `contextSummary` for turn 2 states that the previous answer discussed specific verified
     pieces;
   - the router's chosen profile is a continuation path (`full_stylist`), and the resulting
     outfits draw from the pieces turn 1 actually discussed.
2. **Unrelated-pivot case (the counter-case).** Same first turn, followed by an explicitly
   unrelated fresh request — *"Actually, give me three hiking outfits tomorrow."* Assert:
   - `bounded_multi` remains reachable and is chosen (not forced off by the mere existence of
     `recently_discussed_piece_ids`);
   - the resulting outfits are not constrained toward, or biased by, the previously discussed
     work-dinner pieces.

Together these two cases encode the actual product contract — "the router should know what was
discussed and judge accordingly" — rather than just the one incident that surfaced it.

## 8. Revision history

**First draft (this session, before review):** proposed persisting up to 8 of `retrievedPieceIds`
into `compactFreeformContext`'s merged `pieceIds` list, and making `boundedRouterEligible` false
whenever that evidence existed (plus a §5.4 soft-anchor bias into `bounded_multi`'s candidate pool
when it still fired despite that evidence).

**Revised after external review**, which found two substantive issues, both confirmed against the
actual code before accepting:

- The hard `boundedRouterEligible` veto directly contradicted the (accepted) soft-anchor case in
  the original §5.4 — that state was made unreachable by the veto — and was also shown to be
  unnecessary: the router already runs for the incident turn regardless (`compactRouterTurnHasContext`
  returns `true` for any `new_request`-labeled turn), so the fix only needed to inform the router via
  `contextSummary`, never gate its invocation. §5.4 was dropped as a result — no remaining case it
  would fix once routing itself is correct.
- `retrievedPieceIds` is not "the pieces we discussed" — it can include broadened/fallback search
  candidates the answer never mentioned. `extractPieceIdsFromProse(answerText)` intersected with
  `verifiedPieceIdSets(toolContext)` — already computed by `applyFreeformOutputChecks`'s existing
  truth clause — is the correct, already-canonical signal for what was actually discussed.

The `req.body.pieceIds`-vs-`compactContext.pieceIds` inconsistency (§2) remains flagged as
independent cleanup, kept separate from the causal chain per the review's recommendation.
