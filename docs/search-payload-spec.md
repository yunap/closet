# Spec — stop re-sending the wardrobe the model already has

**Status:** complete — option B implemented and live-verified 2026-08-17 (`thread_1786994644421`)
**Last verified:** 2026-08-17 — every number below regenerates from the live wardrobe

Route: [docs/README.md](README.md). Sources this spec must not restate:
[engine-behaviour-map.md](engine-behaviour-map.md) (caching and the tool loop),
[activity-and-roster-spec.md](activity-and-roster-spec.md) §9 (the architecture question this is a
down payment on), [garment-field-reference.md](garment-field-reference.md) (what each field means).

---

## 1. The measurement

```
MANIFEST      251 pieces   ~12,506 tokens   in the CACHED stable prefix — paid once per turn
tops search    62 pieces   ~13,764 tokens   uncached, written to cache at 1.25x input
```

**One `search_wardrobe` call for tops costs more than the entire wardrobe manifest.** The manifest is
already in the model's prompt on every iteration, and it already carries most of what the search
re-transmits — ~222 tokens per piece where ~50 of them are sitting in cache a few thousand tokens
above.

A manifest line:

```
#1 Whale stripe tee — nautical stripe tee with whale graphic; fabric cotton/light;
   silhouette relaxed; hits hip; pattern stripe/medium; formality everyday; occ casual+city+outdoor
```

The turn that motivated this (`thread_1786954464459`, the verified nature-walk fix) made three
searches and cost **$0.380**, of which ~71% was cache creation.

**Why it compounds.** A tool result is written to cache once at 1.25x input and then re-read by every
later iteration at 0.1x. Trimming ~10,400 tokens off one search is worth roughly
`10,400 x (3.75 + 4x0.30)/1M` ≈ **$0.052** on a $0.38 turn.

## 2. The principle

**The manifest is cached garment truth. A search result should carry judgment, not a
re-description.** What is genuinely new when the model searches is: which pieces passed, how they
were judged *for this request*, and any stable fact the manifest does not already state.

Stable facts belong in the cached prefix, where they are paid for once. Per-request judgments belong
in the tool result, because they cannot be cached — they differ by occasion, activity and weather.

## 3. Field disposition — derived from `buildWardrobeManifestLine`, not assumed

**Already in the manifest, and re-sent by search anyway** — `name`, `reads_as`/`colors`,
`fabric_category`, `fabric_weight`/`visual_weight`, `silhouette`, `length_hits_at`, `pattern_type`,
`pattern_scale`, `formality`, `occasions`, `opacity`, `needs_base`, `shoe_type`, `toe_shape`,
`heel_height`, `season`, and the trust/fit/role flags. Category is implied by the manifest's own
grouping. **This is the redundancy.**

**Genuinely absent from the manifest** — `walk_support`, `neckline`, `sleeve_length`, `sleeve_shape`,
`hem_finish`, `pattern_complexity`, `notes` (120 chars), and `colors` when `reads_as` displaced them.

**Per-request, correctly search-only** — `ruleFit`, `ruleFitLabel`, `weatherFit`, and the note lines
(gate exclusions, fallbacks).

**A correction this exercise produced.** [activity-and-roster-spec.md](activity-and-roster-spec.md)
Part 2 added `walk_support` **and** `heel_height` to search rows on the reasoning that the gate read
both and showed neither. `heel_height` was already in the manifest; only `walk_support` was actually
missing. The fix worked — the model named the right trail shoe — but half of it was redundant, and
that is the same mistake this spec exists to correct, made while writing the diagnosis for it.

## 4. Design

### Option A — trim search to the delta

Search returns `id` + the three judgments + the seven fields the manifest lacks + the image.
Measured: **13,764 → ~3,315 tokens, 76% smaller.** No other surface changes.

### Option B — also move the stable stragglers into the manifest (recommended)

`walk_support`, `neckline`, `sleeve_length`, `sleeve_shape` and `hem_finish` are stable garment
truth. They belong in the cached prefix with their siblings, not re-sent per search. The manifest
grows by roughly 10-15 tokens per piece (~+3k for 251 pieces, a cache **read** at $0.30/M ≈ $0.0009
per iteration), and search collapses to `id` + judgments + image.

B is strictly better economically and leaves one home for stable garment truth instead of two. A is
the safe first step if manifest growth is a concern; they are not exclusive — A then B.

### The constraint neither option may break

**No field may vanish from both surfaces.** The model composes from what it can see, and a field
present in neither the manifest nor the search row is invisible. §6.3 makes that mechanical.

## 5. Risks

- **Silent quality loss.** The pieces available do not change; only the channel describing them does.
  The failure mode is subtle — worse composition, no error. §6 measures identity and coverage
  mechanically and asks for one live A/B; there is no offline test for taste.
- **Manifest size (option B).** `WARDROBE_MANIFEST_MAX_PIECES` is 400 and the reference wardrobe is
  251. Growth is per-piece, so a large wardrobe reaches the cap sooner and falls back to the
  tools-only prompt. Measure the projected size at the cap before shipping B.
- **A wardrobe with no manifest.** Above the cap the manifest is omitted entirely, and a trimmed
  search would then be the model's only view of a garment — and an insufficient one. Trimming must
  be conditional on the manifest actually being present in the prompt.

## 6. Acceptance

1. **Measured:** the three searches from `thread_1786954464459` re-run offline, reporting before and
   after token counts. Target ≥60% reduction on the tops search.
2. **Roster identity unchanged:** the same piece IDs, in the same order, with the same `ruleFit` /
   `weatherFit` values as today. This spec changes description, never selection.
3. **Coverage test — no field lost.** A test asserting that every field `search_wardrobe` returns
   today appears in either the manifest line or the trimmed search row, for a fixture piece with
   every field populated. This is the guard against silent information loss and must fail loudly.
4. **Fallback:** with the manifest absent (above the piece cap), search returns the full rows as it
   does today.
5. `npm test` green; the 30-scenario candidate A/B byte-identical; engine map amended.
6. **One live turn** re-asking the nature-walk question, compared against `thread_1786954464459` on
   cost, iteration count, and whether the model still names the right trail shoe unprompted.

## 7. Out of scope

**Images.** Visual grounding is a founding principle here; the thumbnails stay exactly as they are.

**Batching independent tool calls** (lever 2). Seven tool calls arrived over five tool-use iterations
in the measured turn, so they are near-serial, and the loop already supports parallel `tool_use`
blocks — nothing tells the model to use them. Separate change, separate measurement.

**Pre-resolving the roster server-side** ([activity-and-roster-spec.md](activity-and-roster-spec.md)
§9). The larger move, and this spec is a down payment on it rather than a competitor: a smaller,
judgment-shaped search result is closer to the workbench that design hands over.

## 8. Open

1. ~~A, or straight to B~~ **RULED: B, implemented 2026-08-17.** Measured outcome, the three searches
   of `thread_1786954464459`: **25,747 → 9,613 tokens, −63%**, worth ~$0.08 of a $0.380 turn once
   cache-write and four downstream re-reads are counted. Roster identity verified unchanged — same
   IDs, same `ruleFit`, same order.
2. ~~`notes`~~ **KEPT in the search row.** It is per-piece free text that the manifest does not carry
   at all, so dropping it would have violated §4's constraint. It stays capped at 120 chars.
3. ~~Live A/B~~ **DONE — `thread_1786994644421`, identical prompt, §10.**

## 9. What implementing it cost

The manifest grew **12,506 → 16,063 tokens** (+3,557, +28%; ~64 tokens/piece, projected ~25,600 at
the 400-piece cap). That growth is a cache **read** at $0.30/M — about **$0.001 per iteration** —
against ~16,100 tokens removed from cache **writes** at $3.75/M plus their re-reads. The trade is
roughly 80:1 in favour.

Two things fell out of doing it that were not in the plan:

- **`silhouette none`, `neck none`, `hem none`.** The tagger stores a literal `'none'` for fields
  that do not apply to a garment, and the manifest printed them — a token per field per piece, and
  worse, they read as real values. Now suppressed, which paid back ~400 tokens of the growth.
- **`colors` were invisible for most pieces.** The line showed `reads_as` **or** the colour list,
  never both, so any piece with a `reads_as` had no palette in the manifest at all and search had to
  re-send it every time. Now both, which is why the enriched line is worth more than its size.


## 10. Live A/B — `thread_1786954464459` → `thread_1786994644421`

Identical prompt, new thread, the payload trim as the only variable.

| metric | baseline | after | predicted |
|---|---|---|---|
| cache creation | 71,611 | **58,723** | ~55,000 ✓ |
| cache read | 285,799 | **254,053** | ~220,000 ✗ |
| output | 1,714 | 1,883 | ~1,700 ✓ |
| iterations | 6 | **6** | 6 ✓ |
| **cost** | **$0.380** | **$0.325 (−14.6%)** | ~$0.30 (−21%) |

**Quality holds.** The model still names the right trail shoe unprompted, now reading `walk_support`
from the manifest instead of the search row: *"The grey/orange mesh pair are proper athletic sneakers
with high support — best call for a nature walk on uneven ground. The black canvas sneakers work on a
flatter, easier path."* All three looks use high-support shoes. It also volunteered a bottoms/tops
summary it did not give before.

**Where the prediction was wrong, and why.** I forecast −21% and got −14.6%, because I costed the
manifest growth as a one-off and it is not: the enriched manifest is **re-read on every iteration**.
The write side matched almost exactly — results −16,134, manifest +3,557, net −12,577 predicted
against −12,888 measured — but 3,557 tokens × 6 iterations ≈ 21,300 extra reads ate a third of the
gain. The corrected ratio is ~60:1 on writes alone, ~8:1 once the repeated reads are counted, not
the 80:1 stated in §9 before this was measured.

**The lesson for the remaining levers:** anything added to the cached prefix is paid for once per
*iteration*, not once per turn. That makes iteration count a multiplier on prefix size, which is an
argument for lever 2 (batching) that §7 did not make.
