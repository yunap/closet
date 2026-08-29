# Spec — bound total visual evidence per `search_wardrobe` call

**Status:** implemented 2026-08-29 — call-level ceiling with a per-category floor
**Last verified:** 2026-08-29, via `scratch/search_wardrobe_image_count_check.js`

Route: [docs/README.md](README.md). Sources this spec must not restate:
[engine-behaviour-map.md](engine-behaviour-map.md) §"The shape of a turn" (why the per-category cap
exists at all), [freeform-batched-discovery-spec.md](freeform-batched-discovery-spec.md) (why
batching categories into one call is the encouraged default shape).

---

## 1. The defect

`SEARCH_WARDROBE_VISUAL_CAP` (16) was applied per `wardrobeCategoryGroup`, with no ceiling on the
call as a whole. `search_wardrobe`'s own tool description tells the model to batch every category an
outfit needs into one call — the encouraged, common-case shape for an ordinary composition turn is
2-4 categories, occasionally the full 6 (`top`, `bottom`, `dress`, `outerwear`, `shoes`,
`accessory`). A 4-category visual batch therefore attached up to 64 images in one tool result; a
6-category batch, up to 96.

**This is not theoretical.** Diagnosed 2026-08-27–29 while chasing a ~103k-token tool-loop turn that
first looked like a Gemini-specific image-token anomaly: `category:['top','bottom','dress',
'outerwear']` with `visual:true` attached far more than 16 images. `scratch/
search_wardrobe_image_count_check.js` reproduced it locally, for free, with no model call —
`executeTool()` is a plain function — confirming 16 images per category, 4 categories, 64 images
total, before the rest of the prompt. The image-token math for that image count is consistent with
the observed turn. The anomaly was this policy, not a provider defect, and it reproduces
deterministically on every multi-category visual batch — it does not depend on wardrobe size, rare
input, or provider choice, only on how many categories a request needs.

## 2. Why the fix is not "shrink the per-category cap"

The per-category cap (rather than one fixed total split across categories) was introduced
deliberately: engine-behaviour-map.md records that splitting a flat 16-image total naively across
three categories would have hand the model "a third of the photos it used to get," and rejected that
as starving visual grounding — a founding principle here — to save a round-trip. That reasoning holds
and this spec does not reopen it: no category should be reduced to a token-gesture number of images
just because the call also asked about other categories.

What that reasoning does not establish is that the *per-call total* should be allowed to grow
linearly and unbounded with category count. Those are two separate policy questions — "how many
images per category" and "how many images total" — and only the first had been decided.

## 3. Design

Two constants, alongside the existing per-category ceiling:

```js
const SEARCH_WARDROBE_VISUAL_CAP = 16        // unchanged: per-category ceiling
const SEARCH_WARDROBE_VISUAL_TOTAL_CAP = 40  // new: soft ceiling on the whole call
const SEARCH_WARDROBE_VISUAL_FLOOR = 8       // new: no category drops below this from division alone
```

Per-category allocation for a call spanning `categoryCount` distinct groups:

```js
perCategoryVisualCap = categoryCount <= 1
  ? SEARCH_WARDROBE_VISUAL_CAP
  : clamp(floor(SEARCH_WARDROBE_VISUAL_TOTAL_CAP / categoryCount), SEARCH_WARDROBE_VISUAL_FLOOR, SEARCH_WARDROBE_VISUAL_CAP)
```

Worked cases:

| categories | old total | new per-category | new total |
|---|---|---|---|
| 1 | 16 | 16 (unchanged) | 16 |
| 2 | 32 | 16 (unchanged — 40/2=20, clamped to 16) | 32 |
| 3 | 48 | 13 | 39 |
| 4 | 64 | 10 | 40 |
| 5 | 80 | 8 (floor) | 40 |
| 6 | 96 | 8 (floor) | 48 |

1- and 2-category calls are untouched — the common narrow-search case pays nothing. The measured
4-category anomaly drops from 64 to 40 images (-37%). The floor guarantees every requested category
keeps at least half its original ceiling even at the full 6-category span, so no category is reduced
to the "a third of the photos" outcome the original per-category design rejected — 8 is worse than 16
but nowhere near the ~5 a naive even split of the old flat cap would have produced at 3 categories.

The floor means the total is not hard-bounded for every possible input (`floor × categoryCount` can
exceed `TOTAL_CAP` once the floor dominates) but `categoryCount` is bounded by the six-way
`wardrobeCategoryGroup` taxonomy in practice, so the real worst case is 48, not unbounded.

Unpictured candidates are unaffected: the cap has only ever limited thumbnails attached to a result
row, never which rows are returned (`freeform-batched-discovery-spec.md`'s acceptance case 1).

## 4. Telemetry added alongside

`categoryCount` and `imagesAttached` were previously unrecoverable from `tool_sequence` (which
records tool names per iteration, not arguments), so frequency of large multi-category visual
batches in real traffic was unmeasured. Two counters were added to `freeform_generation_runs` via
`bumpFreeformDiagnostic`:

- `search_visual_images_attached` — running total of images actually attached across all
  `search_wardrobe` calls in the turn
- `search_visual_max_category_count` — the largest category span seen in one visual call this turn

This lets the actual distribution of batch sizes in live traffic be queried later
(`scratch/measure_freeform_turns.js` already copies the DB safely) without a new live call —
answering the frequency question this spec's fix does not depend on, but that should inform whether
`SEARCH_WARDROBE_VISUAL_TOTAL_CAP`/`FLOOR` need retuning.

## 5. Open

The two constants (40, 8) are a first bound, not a measured optimum — chosen to leave 1-2 category
calls untouched and to keep the floor at half the original per-category ceiling. Retune once the new
telemetry shows the real distribution of category counts in visual search calls.
