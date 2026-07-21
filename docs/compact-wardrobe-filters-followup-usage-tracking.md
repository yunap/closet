# Follow-up Spec: Garment Usage Tracking (wear count, last-used)

Split out from the original "Compact Wardrobe Filters and Sorting" spec. The parent
spec's sort menu and "Wardrobe mix" behavior assumed data that doesn't exist yet in
`pieces` (see `db.js` ~lines 55–74). This spec scopes the work needed before those
pieces of the UI spec can ship. See
[compact-wardrobe-filters-v1.md](compact-wardrobe-filters-v1.md) for what shipped
without this.

## Owner ruling: what counts as "used"
The app can only know what it observed — not whether the user actually wore
something IRL. "Used" means: **the piece was referenced by the Visual Composer
(saved to a board) or came up in a Stylist chat recommendation.** Not a manual
"mark as worn" action — that data source doesn't exist and isn't being added.

## Feasibility (researched — good news, no new schema for the two main sources)

**Visual Composer usage — already queryable today, no migration needed.**
`saved_boards` (`db.js:123–140`) has `pieces` (JSON), `payload` (JSON), and a real
per-record `created_at` timestamp. `collectPieceIdsFromSavedBoardRow`
(`styling-engine/rules.js:549`) already walks a board row and extracts every
referenced piece ID — it's live in production use (`routes/crud.js:657`,
`getSavedBoardMemory`/`getSavedBoardInfluenceForPair` in `rules.js:573–620`). "Most
worn via Visual Composer" and "recently used via Visual Composer" can both be
computed by running that same helper across `saved_boards` ordered by
`created_at` — no new column, no new instrumentation.

**Stylist chat usage — needs new extraction logic, but still no schema change.**
`chat_threads` (`db.js:209–219`) has no dedicated messages table; the full
conversation lives in `payload.messages[]`. When the stylist proposes an outfit,
individual messages carry `structuredOutfits[].pieceIds` (see
`src/components/StylistChat.jsx`, multiple call sites e.g. ~2410, 2596, 3165).
There's no existing helper that walks this the way
`collectPieceIdsFromSavedBoardRow` does for boards — that's the one piece of new
code needed here: a `collectPieceIdsFromChatThreadRow`-style function. Caveat:
`chat_threads` only has thread-level `created_at`/`updated_at`, not per-message
timestamps, so "recently used via chat" can only be as precise as "this thread was
last touched then" — not which turn within it mentioned the piece. Acceptable
given the owner's framing (this is a best-effort "what has the app engaged with"
signal, not a literal wear log), but worth stating plainly so nobody expects
message-level precision later.

**Wear count / last-used**: since both sources are already timestamped rows, wear
count and last-used can be **computed at query time** (count/max over matching
`saved_boards` + `chat_threads` rows per piece ID) rather than requiring a
persisted `wear_count`/`last_used_at` column on `pieces`. Simpler and always
consistent with the underlying data — no write-path instrumentation to keep in
sync. Only revisit persisting a column if the live join proves too slow at scale.

## Owner ruling: "archived/hidden" for garments doesn't exist as its own concept
Researched what "archived"/"hidden" actually mean elsewhere in the app:
`saved_boards`/`calibration_images.archived` is a default-list-view filter (an
"Ignore"/"Restore" toggle, `VisualLab.jsx:526–531`), and
`saved_boards.hidden_from_lookbook` is a purely cosmetic Lookbook-display filter
(`OutfitLookbook.jsx:1644`) — neither is an AI-memory exclusion, and neither has
an equivalent on `pieces`. The Wardrobe piece detail exposes only Delete and Edit
(`src/views/PieceDetail.jsx:283–288`) — there's no archive action for garments
today, and `pieces.recommendation_status = 'avoid'` only blocks AI auto-styling
(`src/utils/wardrobeAiContext.js:166`), it doesn't hide a piece from the grid.

Owner confirmed: no new archived/hidden concept needed, and no other "I don't want
to see this in the wardrobe" scenario exists beyond what's already covered.
**Wardrobe mix should exclude pieces where `status = 'donated'`** — a piece
confirmed no longer owned has no business in a "what should I wear" mix. This
reuses the existing `pieces.status` column and value; no migration, no new
column, no change to what `status` means anywhere else.

## Proposed scope (revised — smaller than originally estimated)
- Add `collectPieceIdsFromChatThreadRow` (or similar), mirroring the existing
  saved-boards helper, to extract piece IDs from `chat_threads.payload`.
- Query-time (not persisted) computation of per-piece wear count / last-used,
  combining `saved_boards` + `chat_threads` signals.
- Wire "Most worn" and "Recently used" sort options into the Wardrobe sort
  dropdown added in the v1 compact-filters work.
- Extend "Wardrobe mix" (already deterministic per v1) to:
  - exclude pieces with `status = 'donated'`
  - weight in "overlooked" pieces (low/no computed usage)

## Out of scope
No change to filter semantics, search, garment cards, add/import flows — same
preserve list as the parent spec. No literal "wore this" tracking — explicitly
ruled out by the owner.

## Acceptance criteria (draft)
1. "Most worn" / "Recently used" reflect Visual Composer + Stylist chat
   references only — no claim of real-world wear.
2. No new columns added unless query-time computation proves too slow.
3. Wardrobe mix excludes `status = 'donated'` pieces and includes overlooked
   (low-usage) pieces.
4. No new archived/hidden concept added to `pieces`; `status` semantics
   elsewhere unchanged.
