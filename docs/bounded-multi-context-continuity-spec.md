# Spec — a prose-only stylist answer leaves no continuity for the next turn

**Status:** implemented (§9) — revised twice after external review before implementation (see §8 for
what changed and why, across both rounds). The design differs from the first draft in four ways: the
persisted field holds pieces actually *discussed* in the answer, not raw search candidates; the
router is informed rather than deterministically gated; the soft-anchor bias into `bounded_multi`
(originally §5.4) is dropped; and the persisted IDs are explicitly routed to `full_stylist` as
continuation context requiring fresh `view_pieces` re-verification, not treated as already verified.
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

Given all three are `null`/empty, the execution router (which does run for this turn — see §5.4) is
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
but it is not part of the causal chain for this incident** (§5.4 explains why) — tracked as
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

**Replace semantics, not accumulate-and-carry-forward.** `saveStylistConversationState` replaces the
entire `state_json` blob — it is not a partial merge (`conversationState.js:14` does
`INSERT ... ON CONFLICT DO UPDATE SET state_json = excluded.state_json`, the whole value). This spec's
first two drafts disagreed with themselves about what that implies for this field (flagged directly
by the second review — see §8): does it need to survive untouched across turns, or does it reset?
The resolved semantic, chosen deliberately over "durable accumulated memory":

> `recently_discussed_piece_ids` reflects only the immediately preceding accepted `full_stylist`
> answer. It is not a growing memory and does not need multi-turn carry-forward.

Concretely: **the write in this section is the sole and always-explicit authority for this field's
value.** Every `full_stylist` turn that reaches its answer branch writes it — `discussedIds.slice(...)`
if the answer cited verified pieces, or an explicit empty array if it didn't (never omitted, so a
stale value from two turns ago cannot survive by default). This write always runs *after*
`core.js:4505`'s earlier, same-turn save (prompt assembly happens before the tool loop and the
answer), so it always supersedes it within one turn — `core.js:4505` does not need to be taught to
preserve this field in its own save; see §5.2 for what it *does* need to do, which is read it, not
re-save it.

A `bounded_multi` turn that succeeds is also a legitimate replacement: `boundedConversationStateFromToolContext`
does not carry this field forward, so a successful `bounded_multi` turn implicitly clears it — correct,
since that turn produces its own `current_outfit_set`, which becomes the new "what we're discussing"
via the mechanism that already exists for outfit cards. No code change needed there. A compact-profile
turn (`general_advice`, `wardrobe_inventory`, ...) never calls either writer, so it leaves whatever
was last persisted untouched — also correct, since those turns are wardrobe-independent by design and
have nothing to say about which pieces are "recently discussed."

**5.2 — Route the persisted IDs to `full_stylist` as continuation context requiring re-verification —
not as already-verified evidence.**

A gap the second round of review found: §5.4 (below) tells the router a subject exists, which fixes
*routing*. But once the router picks `full_stylist`, the actual IDs went nowhere — the first
revision of this spec read `recently_discussed_piece_ids` from exactly one consumer (the router's
`contextSummary`), which left Acceptance Criterion 1's requirement — *"the resulting outfits draw
from the pieces turn 1 actually discussed"* — with no mechanism to make it true. Relying on the
pieces still being nameable from raw conversation history text is exactly the "approximate
conversational recovery" this spec exists to replace, and more importantly it would violate the
turn's own verification contract if the model treated a name it recalled from prose as already
verified.

The fix: `buildStylistConversationPayload` ([styling-engine/core.js:4277](../styling-engine/core.js#L4277))
already reads `restoredState` once, at the top, before the tool loop. Read
`restoredState.recently_discussed_piece_ids` there too, and surface it in `threadState` (the same
JSON block already injected as `THREAD STATE (STRUCTURED)`, `core.js:4694`) as its own key, with
accompanying instruction text — not merged into `current_outfit_set`, and **not marked as retrieved
or seen**:

```js
recently_discussed_pieces: restoredState.recently_discussed_piece_ids?.piece_ids?.length
  ? { piece_ids: restoredState.recently_discussed_piece_ids.piece_ids }
  : undefined
```

```
'Pieces explicitly discussed in the previous answer (see recently_discussed_pieces in THREAD STATE, if present) are CONTINUATION SUBJECTS ONLY — they have not been verified this turn. If the user is continuing that discussion (e.g. "yes, put those together", "make outfits from those"), call view_pieces on them before composing or citing them. Do not cite or compose from them until they have been re-verified this turn, and do not assume they are still relevant if the user has moved on to something unrelated.'
```

This is a read, not a write: `recently_discussed_piece_ids` is not added to `toolContext.allowedPieceIds`,
not pre-populated into `verifiedPieceIdSets`, and not merged into `compactContext.pieceIds` (§5.3
below). The model must call `view_pieces` — the existing, cheap,
purpose-built tool for exactly this — to satisfy the same current-turn verification contract every
other citation already goes through. This keeps `recently_discussed_piece_ids` honestly labeled as
what it is: a hint about where to look, not a claim about what is already true this turn.

**5.3 — Do NOT fold it into `compactFreeformContext`'s merged `pieceIds` list either. Two read-only
consumers, neither of which is direct ID-scoped subject resolution.**

At `routes/ai.js:4732`, `compactContext.pieceIds` is used as a **direct subject-resolution
fallback** for `garment_fact` when a vague reference ("these shorts") can't be resolved any other
way — and that fallback already has a named, documented failure mode in the code's own comment
(`thread_1787435527800 msg 16/17`: an unresolved vague reference falling back to *every* piece in
the accumulated current-card set). Even with the more precise `discussedIds` set from §5.1, merging
it into that list would widen the scope `garment_fact` resolves an ambiguous reference against in a
way that field was never designed for.

`recently_discussed_piece_ids` has exactly two consumers, both read-only, neither treating it as a
resolved or verified subject list: the router's `contextSummary` (§5.4) and `full_stylist`'s
`threadState` continuation-context block (§5.2, requiring `view_pieces` before use). Nothing else
reads it.

**5.4 — Inform the router; do not gate it.**

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
- `general_advice`/`wardrobe_inventory` never reach `full_stylist` at all (they end the turn as a
  compact profile — message-lifecycle.md's profile table), so they never touch this field either
  way; whatever a prior turn set stands untouched, which is correct since those turns have nothing
  wardrobe-specific to say about it. A `full_stylist` turn that runs but cites no verified pieces
  (e.g. a clarifying question) explicitly writes an empty array per §5.1's replace semantics — not
  "absent," so a stale value from an earlier turn cannot linger past the turn that supersedes it.
- No change to `search_wardrobe`'s own behavior, the visual budget cap (#272), or EXIF handling
  (#273) — unrelated surfaces.

## 7. Acceptance criteria

Two live-shaped test cases, both required — one alone would let a future change reintroduce exactly
the bug just rejected in §5.4, and the missing full_stylist mechanism added in §5.2:

1. **Continuation case (the original incident).** Reproduce the two-turn sequence: a `full_stylist`
   coverage answer naming specific pieces, followed by *"yes, put together three complete
   outfits."* Assert:
   - the execution router is still invoked for turn 2 (not skipped — guards against a future
     "fix" that reintroduces a hard `boundedRouterEligible` veto instead of informing the router);
   - `contextSummary` for turn 2 states that the previous answer discussed specific verified
     pieces;
   - the router's chosen profile is a continuation path (`full_stylist`);
   - `full_stylist`'s prompt for turn 2 includes the `recently_discussed_pieces` continuation-context
     block from §5.2, and the model calls `view_pieces` on those ids before composing (i.e. they are
     re-verified this turn — `verifiedPieceIdSets(toolContext)` includes them only *after* that
     call, never before it, which is what distinguishes this from treating stale IDs as pre-verified);
   - the resulting outfits draw from the pieces turn 1 actually discussed.
2. **Unrelated-pivot case (the counter-case).** Same first turn, followed by an explicitly
   unrelated fresh request — *"Actually, give me three hiking outfits tomorrow."* Assert:
   - `bounded_multi` remains reachable and is chosen (not forced off by the mere existence of
     `recently_discussed_piece_ids`);
   - the resulting outfits are not constrained toward, or biased by, the previously discussed
     work-dinner pieces.

Together these two cases encode the actual product contract — "the router should know what was
discussed, the stylist can pick it back up, and neither treats it as durable memory or pre-verified
truth" — rather than just the one incident that surfaced it.

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

**Revised again after a second round of external review**, on the resulting design (router informed,
not gated; `recently_discussed_piece_ids` derived from cited-and-verified prose, not raw retrieval).
That review found the first revision correct as far as it went, but incomplete in one substantive way
and ambiguous in one smaller way:

- **The missing mechanism (substantive).** §5.2 (as it stood after the first revision) declared
  `recently_discussed_piece_ids` had exactly one consumer — the router's `contextSummary`. But §6
  and Acceptance Criterion 1 both asserted that a continuation turn's outfits would "draw from the
  pieces turn 1 actually discussed" once routed to `full_stylist` — a claim the design had no
  mechanism to make true. The persisted IDs reached the router and then went nowhere. Fixed by
  adding §5.2 (new): `buildStylistConversationPayload` reads `restoredState.recently_discussed_piece_ids`
  and surfaces it in `threadState` as an explicit continuation-context block requiring `view_pieces`
  re-verification before use — never pre-marked as retrieved/seen/verified, and never merged into
  `compactContext.pieceIds`, preserving the boundary the first revision already got right for a
  different reason (§5.3).
- **State-lifetime ambiguity (smaller, but a real inconsistency).** The first revision's §5.1 said
  the field "must not be silently erased" by the other writer, while §6 said a turn with nothing to
  discuss leaves it "simply absent" — two different implied lifetimes (durable-until-overwritten vs.
  reset-per-turn) for a full-blob-replace store, never reconciled. Resolved explicitly in §5.1:
  `recently_discussed_piece_ids` reflects only the immediately preceding accepted `full_stylist`
  answer, is always written explicitly (including as an empty array when nothing was discussed) by
  the one writer that has the authority to set it, and does not need `core.js:4505` to preserve it
  across turns, since that writer runs earlier in the same turn and is always superseded by this
  section's write before the turn ends.

No further open questions from this round.

## 9. Implementation

Implemented as designed, plus one correctness gap found only while writing the code — the design
docs above didn't need to know about it, but the implementation would have been silently broken
without it.

**The gap: `buildStylistConversationPayload` only loaded `restoredState` at all when
`requestedConversationMode !== 'new_request'`** ([styling-engine/core.js:4277](../styling-engine/core.js#L4277),
pre-existing code). That guard exists to keep a genuinely-fresh request from inheriting stale
`established`/`current_outfit_set` context — correct for those two fields. But it meant `restoredState`
itself was an empty `{}` on any `new_request`-labeled turn, so §5.2's read of
`restoredState.recently_discussed_piece_ids` would never fire on exactly the turns this spec exists
to fix — a `new_request`-mislabeled continuation is the incident's own root cause (§2.2). Fixed by
loading `restoredState` unconditionally, while keeping every *existing* consumer's own gate
unchanged: `active_outfit`/`active_piece_ids` restoration and `current_outfit_set` restoration both
kept their original `requestedConversationMode !== 'new_request'` checks explicitly (one of them,
`restoredEstablished`, previously relied implicitly on the outer `{}` rather than checking the mode
itself, so it needed an explicit guard added rather than removed). Only
`recently_discussed_piece_ids` reads unconditionally, consistent with its own designed semantic — a
read-only hint the model judges relevance of, not a restore-or-drop context switch. A regression
test (`test/bounded_multi_context_continuity.test.js`) asserts `established`/`current_outfit_set`
still do not leak on a `new_request` turn while `recently_discussed_pieces` does surface.

**What was built, mapped to the design:**

- `recentlyDiscussedPieceIdsFromAnswer(answerText, toolContext, { cap })` ([routes/ai.js](../routes/ai.js))
  — new, exported, directly unit-tested helper implementing §5.1's `citedIds ∩ (retrieved ∪ known)`,
  capped at `RECENTLY_DISCUSSED_PIECE_CAP` (16). Extracted into a named function (matching the
  existing `boundedConversationStateFromToolContext` precedent) rather than left inline, so it is
  testable without the HTTP layer.
- The `full_stylist` answer branch now reads the session's current persisted state, spreads it, and
  overlays `recently_discussed_piece_ids` — never a from-scratch save — per §5.1's "must layer onto,
  not replace" requirement, since `saveStylistConversationState` has no partial merge.
- The router's `contextSummary` (§5.4) gained one more clause, read from the same persisted state,
  sourced before the router call: *"previous answer discussed N specific verified wardrobe
  piece(s)"* / *"no recently discussed wardrobe pieces"*.
- `buildStylistConversationPayload`'s `threadState` gained `recently_discussed_pieces` (§5.2),
  populated only when non-empty, plus one instruction sentence requiring `view_pieces` before use —
  never merged into `current_outfit_set`, never marked retrieved/seen.
- `compactFreeformContext`/`compactContext.pieceIds` (§5.3) — untouched, as designed.
- `bounded_multi`'s own writer (`boundedConversationStateFromToolContext`) — untouched, as designed;
  it already implicitly clears the field per §5.1's replace semantics.

**Acceptance criteria (§7) — coverage status:** unit-tested directly: the persisted-set computation
(cited-and-verified vs. raw-retrieved, cap enforcement, empty-answer case) and
`buildStylistConversationPayload`'s continuation-context surfacing (both the positive case and the
`new_request` regression guard). **Not yet covered:** a full live-shaped integration test driving
`/api/ai/ask` through the actual router classification for both Acceptance Criterion 1 (continuation
→ `full_stylist` → `view_pieces` re-verification → composition) and Criterion 2 (unrelated pivot →
`bounded_multi` remains reachable and unbiased) — the existing mock-AI test harness
(`test/aiEndpointContracts.test.js`) supports this but has no router-dispatch mock branch yet to
build on. Worth adding before this is considered fully verified against its own acceptance criteria,
not just its component logic.

**Tests:** `test/bounded_multi_context_continuity.test.js` (7 new), plus the full existing suite
re-run clean (one pre-existing, unrelated failure in `test/accountSettingsLayout.test.js`, confirmed
present with these changes reverted — not caused by this work).

