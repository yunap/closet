# The unfiled garment — a photo the app has no row for

**Status:** proposed 2026-08-20 — **Last verified:** 2026-08-20
**Supersedes:** `provisional-pieces-spec.md` (same day), which was written on a premise the owner
rejected: it assumed the garment in the photo was one she did not own. She was wearing it.
**Precondition shipped:** chat uploads now persist and are owned by their thread (PR #238).
**Authority:** none. This proposes; it does not describe current behaviour.

## The premise correction

The earlier spec asked *"how do we style a garment you do not own?"* That is the rarest case, and
building for it first would have shipped the wrong default.

The real question has nothing to do with ownership. A photo uploaded into chat is simply a garment
**the app has no row for**. The axis is **filed vs unfiled**, and it has three outcomes:

| | Outcome | What the app should do | Frequency |
|---|---|---|---|
| **A** | Already filed — it *is* in the wardrobe, unrecognized | resolve to the existing id; offer to attach the photo as `worn_photo` | common |
| **B** | Hers, never filed | file it — a normal active piece, through the existing intake path | common |
| **C** | Genuinely not hers — store try-on, borrowed, considering buying | a provisional row, thread-scoped | rare |

Only C needs new representation. **A needs no new row at all**, and B needs a path into a flow the
app already has and simply cannot reach from chat. The earlier spec specced C and treated it as the
default, which would have quietly made every unfiled garment a second-class one — including the
user's own clothes.

The live case that started this, `thread_1787214321522`, is **outcome A or B**: the owner was
wearing the dress and photographing herself in it.

## What the live thread actually proves

Five messages about one uploaded dress.

| # | Question | What happened | Needs a row? |
|---|---|---|:--:|
| 1 | "what do you think about this dress?" | accurate, specific critique from the photo | no |
| 2 | "self-conscious about this deep V, anything to cover it?" | blind — confident advice about a neckline it could not see | no |
| 3 | "do I own any tank to do the layering?" | a six-row category census | no |
| 4 | "which ones would work?" | zero searches, **no card produced** | **yes** |
| 5 | "what color is this dress?" | "I don't have a photo of the dress in front of me" | no |

**Four of five turns need only the photograph.** Persisting it (shipped) plus routing that carries
it fixes 1, 2, 3 and 5. Only turn 4 — the card — needs the garment to exist as a row, because
`propose_outfit` resolves every piece through:

```js
// styling-engine/tools.js:1480
const row = db.prepare("SELECT * FROM pieces WHERE id = ? AND status = 'active'").get(id)
```

**This is the whole trigger rule: the card, not the upload.** Nothing is created when a photo
arrives. Filing happens the first time the user asks for something a photo alone cannot answer.

> The earlier spec drifted into tagging every upload. That was wrong on cost — most uploads want
> one critique and nothing more — and wrong on consent: an upload is not a request to add
> something to your wardrobe.

## Resolving which outcome it is

The naive order is to match the photo against the wardrobe and see if it is already there. **That
is the expensive order.** Matching one photo against 251 pieces is a visual comparison problem;
tagging one photo is a single call the app already makes routinely. Tag first, and the tags do the
narrowing for free:

1. **Tag the photo once** — the existing `/tag-piece` path (`routes/ai.js:1170`), which produces
   `category`, `formality`, `fabric_category`, `length_hits_at`, `reads_as`, `field_confidence`.
   One call, the same one every intake already pays.
2. **Narrow by SQL, at no cost.** `category = 'dress'` takes 251 candidates to roughly 20.
   Structured tags — length, formality, fabric, colour — cut it further. This is a `WHERE` clause,
   not a model call.
3. **Ask the human.** She knows whether it is hers, and she knows in one glance which of the four
   remaining dresses it is. Identity is a question, not an inference.

Step 3 is the important one. **Matching is not a model capability we should buy.** The owner is
present, the candidate set is small, and a wrong silent match is far worse than a question: it
would attach a stranger's photo to her garment, or file a duplicate of something she already owns.

This also disposes of the cost objection to tagging. The tag is not overhead spent to enable
matching — it is the same work outcome B needs anyway, and outcome A needs it only once.

## Outcome A — already filed

No new row. Resolve to the existing piece id and the turn proceeds as an ordinary wardrobe turn,
with every gate, memory channel and card path already working.

One decision: the photo. `pieces` already carries `worn_photo` alongside `photo`, and
`POST /pieces` accepts both (`routes/crud.js:272`). A confirmed match is a free opportunity to
attach a real worn photo to a garment that may only have a hanger shot — which is exactly the
evidence the composer and the gates most want. See R2.

## Outcome B — hers, unfiled

This is intake, and intake already exists end to end
([flows/piece-intake-and-tagging.md](flows/piece-intake-and-tagging.md)). The only missing part is
a path to it **from a chat message**. The garment becomes a normal `active` piece; nothing about
it is special afterwards.

The consent point matters more than the plumbing: filing must be the user's action, not a side
effect of asking a question. See R1.

## Outcome C — not hers

Only here does anything new exist.

### Why a new status, not a flag

`status = 'active'` is the single load-bearing predicate for "is this in the wardrobe." It appears
in **28 server-side queries** across `styling-engine/tools.js`, `core.js`, `rules.js`,
`routes/ai.js`, `routes/importer.js` and `routes/crud.js`, plus four frontend views. Nothing else
marks membership. Enumerate before changing:

```bash
grep -rn "status = 'active'" --include=*.js styling-engine/ routes/
```

**Design 1 — a new `status` value (`provisional`).** All 28 queries exclude it automatically and
correctly: not in the manifest, not in `search_wardrobe`, not in coverage, not in inventory counts,
not in a capsule roster, not in the importer. Then the few sites that *should* see it are widened
deliberately, one at a time.

**Design 2 — keep `active`, add a flag.** The reverse: it leaks into all 28 by default and each
must be narrowed. A missed site inflates the user's wardrobe count, or proposes a borrowed dress in
an unrelated outfit next week.

**Recommendation: Design 1**, because the failure mode of a missed site is a garment she does not
own appearing in her wardrobe, and `pieces.status` already carries non-active values that behave
exactly this way.

### The widening list

The only sites that learn about a provisional piece. Each **scoped to the owning thread** — a
provisional piece is never globally visible.

| Site | Tool / purpose | Change |
|---|---|---|
| `tools.js:499` `resolvePiecesByIds` | shared id resolution | accept thread-owned provisional ids |
| `tools.js:1480` | `propose_outfit` | the one that makes a card possible |
| `tools.js:1787` | `view_pieces` | so the user can be shown it |
| `tools.js:1890` | `suggest_slot_swaps` | swapping *around* a provisional anchor |
| `tools.js:2085` | `render_preview` | image render including it |

**Not widened:** `search_wardrobe` (`tools.js:1075`), `wardrobe_coverage` (`tools.js:2114`),
`plan_outfit_set` (`tools.js:2341`), the manifest (`core.js:4134`), the inventory census
(`routes/ai.js:4041`). *"Search my wardrobe" must keep meaning my wardrobe.* A provisional piece
reaches the model as **declared turn context**, the way `activeContext` already does — never as a
search result. The moment it is findable by search, every count and coverage answer becomes a lie.

### Lifecycle

1. **Create** — only when a turn needs the garment as a card subject. `status = 'provisional'`,
   thread association, real tags from step 1 above.
2. **Use** — visible to the five widened sites, thread-scoped, rendered with an explicit
   "not in your wardrobe" marker so no card implies ownership.
3. **Promote** — "Add to my wardrobe" flips `status` to `active`; all 28 queries pick it up with no
   further work. This is the payoff of Design 1, and it is also outcome C becoming outcome B when
   she buys the thing.
4. **Expire** — deleted with its thread. `DELETE /chat-threads/:id` already unlinks thread-owned
   uploads, and its `pieces`/`outfits` reference check was written for precisely this: a promoted
   piece must survive its thread's deletion.

## Owner rulings required

- **R1 · Who decides the outcome, and when.** The resolution above ends in a question to the user.
  Is that question asked inline in chat ("is this one of yours? I think it might be your navy
  wrap dress"), or does the app pick a default and offer a correction? Asking is honest but adds
  friction to a casual "what do you think of this?".
- **R2 · The worn photo on outcome A.** On a confirmed match, attach the upload as `worn_photo`
  automatically, offer it, or ignore it? Automatic is the most valuable and the most surprising —
  it silently edits a garment she did not ask to edit.
- **R3 · Search visibility for C.** Confirm: context, never a `search_wardrobe` result. A different
  ruling changes the whole design.
- **R4 · Lookbook saves containing a provisional piece.** Block the save, force promotion first, or
  allow it? Note `routes/crud.js:1614` already treats non-active linked pieces as orphans in the
  todo cleanup, so "allow" has an existing consequence to trace first.
- **R5 · Memory about a provisional piece.** It has an id, so `styling_rules_learned` (channel B in
  [feedback-and-memory-map.md](feedback-and-memory-map.md)) mechanically works — but the lesson dies
  with the thread unless the piece is promoted, which may make teaching it feel broken.
- **R6 · Counts.** Confirm a provisional piece appears in **no** user-visible number. This spec
  assumes yes.
- **R7 · Gate strictness with thin tags.** When a piece's tags are low-confidence
  (`field_confidence`), do the gates hold at full strictness — risking rejecting a garment she is
  looking at — or soften with disclosure? The standing rule that saved tags are evidence rather
  than infallible was written for owned pieces she can correct in a form.

## Acceptance

`thread_1787214321522` replayed, dress uploaded once, **treated as hers** (the correct reading):

1. "what color is this dress?" — answered from the photo, on any later turn. No row involved.
2. "do I own any tank to do the layering?" — real retrieval over owned tops, not a census.
3. **"which ones would work?" — the app tags the photo, narrows by category, and asks which of the
   ~4 candidate dresses this is (or offers to file it as new).** Then a card, containing the dress
   and an owned tank.
4. Nothing was created before turn 4, and nothing was created without her saying so.
5. If she files it: wardrobe count goes 251 → 252 and it behaves like any other piece from then on.
6. If it is a store try-on instead: count stays 251, coverage/capsule/manifest unchanged, and
   deleting the thread removes the dress, its photo and any memory written about it.

## What this does not cover

**Routing.** This spec assumes an `/ask` turn can already reach the uploaded photo. Today the
client picks its endpoint from "is a file attached to *this* message" (`StylistChat.jsx`, the
`fileToSend` branch at `:5210`), so message 1 reaches `/outfit-feedback` and every later turn goes
to `/ask` with no access to the photo — see
[message-lifecycle.md](message-lifecycle.md) §9. That decision is open and independent; the two
changes can land in either order, but neither is useful alone.
