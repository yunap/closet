# Spec: Compact Wardrobe Filters and Sorting (v1, trimmed)

Trimmed from the original "Compact Wardrobe Filters and Sorting" spec after auditing
`src/views/PieceInventory.jsx` against it. Items requiring new schema/tracking
(wear count, last-used date, archived flag) are cut to a follow-up —
see [compact-wardrobe-filters-followup-usage-tracking.md](compact-wardrobe-filters-followup-usage-tracking.md).

## Already shipped, no work needed
- "Add pieces ▾" menu (Add one piece / Import pieces / Add paired hanger) — PR #147.
- "Tasks N" badge, separate control next to Add pieces.
- Favorites toggle, URL-backed.
- Active-filter chips row with "Clear all" at 2+ active filters.
- Selected-state color is already walnut-brown (`--accent: #7C5F3C`); focus-visible
  already uses a distinct blue. Only a token rename (`--accent` → `--walnut` or similar)
  is needed to match spec language, not new visual work — confirm before touching CSS.

## Goal
Reduce the Wardrobe filter area while preserving all existing filtering behavior.

Layout:
1. Search row
2. Visible category row
3. One compact filter-and-sort row
4. Active-filter chips only when needed
5. Garment grid

## 1. Search and page actions
No change — search field and Add pieces / Tasks controls already match spec. Verify
menu item labels match spec text exactly ("Add one piece", "Import pieces", "Add
paired hanger + worn photos") and adjust copy only if it differs.

## 2. Keep category visible
No change — category pills stay as the only permanently expanded filter group.

## 3. Compact filter-and-sort toolbar (net-new layout work)
Collapse Occasion and Season (currently expanded pill rows, `PieceInventory.jsx`
~lines 279–295) into dropdown controls, matching the existing Color/Fabric popover
pattern (~lines 298–389).

Row:
```
[Occasion ▾] [Season ▾] [Color ▾] [Fabric ▾] [♡ Favorites]     Sort: Wardrobe mix ▾
```

- Occasion dropdown reuses all current option values, single-select (matches current
  Occasion behavior — do not introduce multi-select here unless product wants that
  as a separate change).
- Season dropdown reuses all current option values, single-select.
- Color and Fabric popovers stay as-is functionally (currently **single-select**,
  not multi-select — the original spec text describing "multi-select behavior" for
  these two does not match current behavior; preserve single-select unless product
  explicitly wants multi-select added as new scope).
- Favorites unchanged.
- Sort control added to the right of the row (see §6 below), same row, no new row.

## 4. Trigger labels
Dropdown shows generic label when nothing selected (`Occasion`, `Season`, `Color`,
`Fabric`); shows selection when set (`Occasion: City`, `Color: Blue`). Since Color/
Fabric stay single-select in v1, use the single-value form, not the `Color · 3` count
form (that count form only makes sense once multi-select ships — track in follow-up
if/when Color/Fabric become multi-select).

## 5. Active-filter chips
Extend the existing chips row (`.active-filter-row`) to also represent Occasion and
Season selections now that they're collapsed into dropdowns, alongside Color/Fabric.
Category stays represented by its selected pill, not a chip (per spec, and matches
current behavior). Rules unchanged: chip removal updates results immediately, row
hidden when nothing active, "Clear all" shown at 2+ active filters.

## 6. Sort options (v1 subset)
Add a sort dropdown with only the options the current data model supports:
- **Wardrobe mix** (default for fully unfiltered wardrobe)
- **Recently added** (existing `date_added` column)
- **Name A–Z**

Cut from v1: **Most worn**, **Recently used**, and the "exclude archived/hidden"
clause of Wardrobe mix — see follow-up spec. Do not stub these into the UI as
disabled options; ship only what works.

Preserve the user's explicit sort choice for the session (in-memory/URL state,
no persistence needed beyond the session, matching current filter-state handling).

## 7. Wardrobe mix behavior (v1 subset)
Deterministic, stable ordering (no reshuffle on render, no model call) that:
- mixes categories
- avoids clustering similar colors
- includes both newer and older pieces
- includes some favorites (existing `favorite` column)
- modestly prefers current-season items (existing season tag)

Cut from v1 (needs new schema, see follow-up):
- "include some overlooked pieces" (requires a notion of usage recency to know
  what's overlooked)
- "exclude archived or otherwise hidden pieces" (no archived/hidden flag exists on
  `pieces` today)

## 8. Filtered-state behavior
Unchanged from original spec: keep selected sort when filters are active; Wardrobe
mix may still diversify within the filtered set; never silently override the user's
sort choice; preserve predictable pagination/scroll.

## 9. Selected and focus states
Confirm `.chip.active` walnut fill and `:focus-visible` blue ring (App.css ~line
420, ~line 425) already satisfy this — likely a no-op or a token rename only.

## 10. Responsive behavior
Unchanged from original spec: toolbar wraps at narrow widths, Sort stays on the same
toolbar, a compact `Filters` popover may bundle Occasion/Season/Color/Fabric on
mobile, Category stays independently accessible.

## Preserve
No change to: filter semantics/values, search behavior, garment cards, task logic,
add/import/batch flows, wardrobe data, favorites behavior.

## Acceptance criteria
1. Only Category remains permanently expanded.
2. Occasion, Season, Color, and Fabric use compact controls.
3. Sort appears on the same toolbar.
4. Default unfiltered sort is Wardrobe mix.
5. Wardrobe mix (v1 subset) is deterministic and visually varied.
6. Active filters (now including Occasion/Season) appear as removable chips.
7. Add flows remain grouped under Add pieces (already true).
8. Existing filtering and add behavior remains unchanged.
9. The garment grid begins noticeably higher on the page.
