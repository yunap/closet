# Provisional pieces — styling a garment you do not own

**Status:** specified 2026-08-20, not implemented. Seven owner rulings required before code.
**Precondition shipped:** chat uploads now persist and are owned by their thread
(`codex/persist-chat-upload`; see [flows/outfit-evaluation.md](flows/outfit-evaluation.md)).
**Authority:** none yet. This proposes; it does not describe current behaviour.

## Why this exists

The app cannot answer *"would this work with what I own?"* about a garment that is not in the
wardrobe — and it offers a button that invites exactly that question. The chat greeting says
"You can also upload a photo of an outfit for feedback."

Live evidence: `thread_1787214321522`, five messages about one uploaded dress.

| # | Question | What happened | Cost |
|---|---|---|---:|
| 1 | "what do you think about this dress?" | `/outfit-feedback` saw the photo. Accurate, specific critique | — |
| 2 | "self-conscious about this deep V, anything to cover it?" | `/ask`, blind. Confident layering advice about a neckline it could not see | **$0.1711** |
| 3 | "do I own any tank to do the layering?" | Router chose `wardrobe_inventory`; returned a six-row category census | $0.0079 |
| 4 | "which ones would work?" | `declare_intent` + `view_pieces`, zero searches, **no card produced** | $0.0667 |
| 5 | "what color is this dress?" | "I don't have a photo of the dress in front of me" | $0.0373 |

Turn 5 was the only honest turn. The blindness began at turn 2 and stayed hidden because
"how do I cover a deep V" is answerable *plausibly* without seeing anything.

Persisting the photo (already shipped) fixes turns 2 and 5 once routing carries it. **It does not
fix turn 4**, and turn 4 is the actual product question. `propose_outfit` resolves every piece
through:

```js
// styling-engine/tools.js:1480
const row = db.prepare("SELECT * FROM pieces WHERE id = ? AND status = 'active'").get(id)
```

The dress has no row and therefore no id, so no card can contain it. The model can advise *about*
the dress forever and never put it *on* anything. That is a representation gap, not a prompt or
routing problem, and no amount of context plumbing closes it.

## The finding that shapes the design

`status = 'active'` is the load-bearing predicate for "is this in the wardrobe." It appears in
**28 server-side queries** across `styling-engine/tools.js`, `core.js`, `rules.js`, `routes/ai.js`,
`routes/importer.js` and `routes/crud.js`, plus four frontend views. Nothing else marks wardrobe
membership. Enumerate before changing:

```bash
grep -rn "status = 'active'" --include=*.js styling-engine/ routes/
```

That gives two candidate designs, and they are not close.

**Design 1 — a new `status` value (`provisional`).** Every one of those 28 queries excludes the
garment automatically and *correctly*: it is not in the manifest, not in `search_wardrobe`, not in
the coverage census, not in the inventory counts, not in a capsule roster, not in the importer,
not in the admin views. Nothing is counted that shouldn't be. Then exactly the few sites that
*should* see it are widened, deliberately and one at a time.

**Design 2 — keep `status = 'active'`, add a separate flag.** The reverse: the garment leaks into
all 28 sites by default, and each must be narrowed. A missed site silently inflates the user's
wardrobe count, or lets a borrowed dress be proposed in an unrelated outfit next week.

**Recommendation: Design 1.** The default must be exclusion, because the failure mode of a missed
site is a garment the user does not own appearing in their wardrobe, and `pieces.status` already
carries non-active values (`consider-donating`, `donated`) that behave exactly this way.

## The widening list

Under Design 1, these are the only sites that must learn about a provisional piece. Each must be
**scoped to the thread that owns it** — a provisional piece is never globally visible.

| Site | Tool / purpose | Change |
|---|---|---|
| `tools.js:499` `resolvePiecesByIds` | shared id resolution | accept thread-owned provisional ids |
| `tools.js:1480` | `propose_outfit` | the one that makes a card possible |
| `tools.js:1787` | `view_pieces` | so the user can be shown it |
| `tools.js:1890` | `suggest_slot_swaps` | swapping *around* a provisional anchor |
| `tools.js:2085` | `render_preview` | image render including it |

**Not widened:** `search_wardrobe` (`tools.js:1075`), `wardrobe_coverage` (`tools.js:2114`),
`plan_outfit_set` (`tools.js:2341`), the manifest (`core.js:281`, `core.js:4137`), and the
inventory count (`routes/ai.js:4041`). *"Search my wardrobe" must keep meaning my wardrobe.* The
provisional piece reaches the model as **declared turn context** — the way `activeContext` already
works — not as a search result. This is deliberate: the moment it is findable by search, every
count and coverage answer becomes a lie, and the model may propose it for an unrelated request.

## Tagging: reuse, do not invent

The app already turns a photo into a tagged garment: `/extract-pieces` and `/tag-piece`
([flows/piece-intake-and-tagging.md](flows/piece-intake-and-tagging.md)). A provisional piece
should be created through that same path, so it arrives with real structured tags —
`category`, `formality`, `fabric_category`, `length_hits_at`, `reads_as`, `field_confidence`.

That matters more than convenience: **the gates read tags, not prose.** A provisional piece with
real tags is checked by the same engine as any owned garment. A provisional piece carrying only a
photo and a name would be a hole in every gate it touches, which is the outcome
[visual-grounding](style_constitution.md) and the gate architecture both exist to prevent.

Cost consequence: one tagger call per upload. That is a real per-upload charge on a flow the user
may treat casually. See ruling R2.

## Lifecycle

1. **Create** — on upload, or lazily on the first request that needs the garment as a subject (R2).
   Row written with `status = 'provisional'` and a thread association.
2. **Use** — visible to the five widened sites, scoped to its thread. Rendered on cards with an
   explicit "not in your wardrobe" marker, so no card ever implies ownership.
3. **Promote** — "Add to my wardrobe" flips `status` to `active`. From that moment every one of the
   28 queries picks it up with no further work. This is the payoff of Design 1.
4. **Expire** — deleted with its thread. The mechanism already exists: `DELETE /chat-threads/:id`
   unlinks thread-owned uploads (`routes/crud.js`), and its `pieces`/`outfits` reference check was
   written for precisely this future — a promoted piece must survive its thread's deletion.

## Owner rulings required

- **R1 · Scope.** Is a provisional piece owned by one thread, or does the user get a persistent
  "not mine" shelf reusable across threads? Thread-scoped is simpler and matches the retention
  already shipped; a shelf is the better product if people try on the same borrowed or
  about-to-buy garment repeatedly.
- **R2 · When to tag.** Eagerly on upload (every upload costs a tagger call, including the many
  that only ever want a one-shot critique), or lazily on the first request that needs structure?
  Lazy is cheaper and matches the observed usage; eager makes turn 2 of a thread instant.
- **R3 · Search visibility.** Confirm the recommendation above: context, never a `search_wardrobe`
  result. A different ruling changes the whole design.
- **R4 · Saving to the Lookbook.** May a saved outfit contain a provisional piece? Options: block
  the save, force promotion first, or allow it and accept an outfit whose linked piece is not
  active. Note that `routes/crud.js:1614` already treats non-active linked pieces as orphans in the
  todo cleanup, so "allow it" has an existing consequence to trace before choosing it.
- **R5 · Memory.** May per-garment memory (`styling_rules_learned`, channel B in
  [feedback-and-memory-map.md](feedback-and-memory-map.md)) be written about a provisional piece?
  It has an id, so mechanically yes — but the memory dies with the thread unless the piece is
  promoted, which may make teaching it feel broken.
- **R6 · Counts.** Confirm a provisional piece appears in **no** user-visible number — wardrobe
  count, category census, coverage, capsule budget. This spec assumes yes.
- **R7 · Gate strictness with thin tags.** The tagger reports `field_confidence`. When a
  provisional piece's tags are low-confidence, do the gates hold at full strictness (risking
  rejecting a garment the user is looking at), or soften with disclosure? Note the standing rule
  that saved tags are evidence, not infallible — but that rule was written for owned pieces the
  user can correct in a form.

## Acceptance

`thread_1787214321522` replayed, un-owned dress uploaded once:

1. "what color is this dress?" — answered from the photo, on any later turn.
2. "do I own any tank to do the layering?" — real retrieval over owned tops, not a category census.
3. **"which ones would work?" — a card, containing the provisional dress and an owned tank**,
   marked as not-in-wardrobe. This is the case nothing today can produce.
4. Wardrobe count still reads 251. Coverage, capsule and manifest unchanged.
5. Deleting the thread removes the dress, its photo, and any memory written about it.
6. Promoting the dress makes it appear everywhere, with no code path aware it was ever provisional.

## What this does not cover

Routing. This spec assumes the `/ask` turn can already reach the uploaded photo and its provisional
row; today the client picks its endpoint by "is a file attached to this message"
(`StylistChat.jsx`, the `fileToSend` branch), so message 1 reaches `/outfit-feedback` and every
later turn goes to `/ask`. That decision is open and independent — see the option B/C discussion
in the session that produced this spec. Provisional pieces are useless until a turn can see them,
but the two changes can land in either order.
