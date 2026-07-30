# Wardrobe color controls — pre-panel interaction specification

**Status:** pre-panel scope; not yet owner-ratified or implemented.
**Depends on:** [color-taxonomy-rules.md](color-taxonomy-rules.md).
**Explicitly excludes:** capsule palette controls and Lookbook color filtering.

## 1. User jobs

The Wardrobe uses the same taxonomy for two different jobs:

1. **Find garments by a useful color area.** “Show me my blue pieces” should find navy, denim,
   dark blue, blue, and light blue without five separate searches.
2. **Record what a garment actually is.** Add/Edit must save exact canonical shades such as
   `navy` or `light blue`; it must never save a family as a substitute for the visible shade.

Family is therefore a retrieval and organization concept. Shade is the persisted garment fact.

## 2. Surface inventory

### Wardrobe filter

- Entry point: `src/views/PieceInventory.jsx`.
- Populated from `/api/pieces/meta`, so it shows only shade values present in the active wardrobe.
- Current presentation is one alphabetical, two-column list of every stored shade.
- Current state is one URL parameter, `color=<shade>`.
- `/api/pieces` performs one exact serialized-array shade match. It has no family query.
- The menu supports a single selection, Escape dismissal, outside-click dismissal, focus return,
  and listbox option semantics.

### Add Piece and Edit Piece

- Shared implementation: `src/components/PieceForm.jsx`; the same component is also opened from a
  Stylist handoff, so changes to it are not Wardrobe-route-only.
- Both render every canonical shade as an unlabeled 32px circular swatch in one wrapping grid.
- A tooltip or accessible name reveals the shade; sighted scanning otherwise depends on
  distinguishing similar swatches.
- The control is multi-select and saves exact shade names to `colors`.
- Manual changes protect the complete `colors` field from later AI retagging.
- AI retagging can update the selected shades only when `colors` is not manually protected.

### Batch Add review

- Implementation: `src/components/BatchAdd.jsx`.
- Uses the same canonical shade list and persistence field, but duplicates the swatch markup rather
  than sharing the PieceForm control.
- It lacks PieceForm's explicit group label, `aria-pressed` state, and per-button accessible name.
- A change here must preserve per-item AI drafts, manual-override marking, and batch save behavior.

### Lookbook “Link pieces” modal

- Entry point: the “Link pieces” action on a saved outfit in `src/views/OutfitLookbook.jsx`.
- This is a wardrobe-retrieval control embedded in an outfit-editing flow: it filters the
  available garment roster but does not change garment color data.
- The current presentation renders every canonical shade as a labeled chip in one wrapping list,
  regardless of whether that shade is present in the active wardrobe. At the current taxonomy
  size, the color controls occupy several rows before the linked and available garment grids.
- The modal's color state is single-select and exact-shade-only. It must follow the Wardrobe
  filter's family → optional exact-shade retrieval model, including populated-family counts and
  the distinction between broad (`Blue`) and exact (`Blue · Navy`) state.
- Changing or clearing the color filter must not alter the modal's pending linked-piece selection.
  Saving remains the only operation that writes `outfit_pieces`.
- The linked-piece strip must remain visible and understandable while the available roster is
  filtered; a linked garment outside the active color result must not silently disappear from the
  pending selection.

### Related fields and excluded surfaces

- `background_color` in PieceForm is currently free text. It describes the literal base of a print
  and is not the same field as the multi-select `colors` taxonomy. Changing its data model or
  visibility is outside this work.
- The Lookbook page-level filter remains a separate client-side exact-shade filter and is
  deliberately excluded. Only the “Link pieces” modal is in scope because it is a garment-roster
  selection surface.
- Capsule palette input/correction is excluded.

## 3. Measured current state — 2026-07-30

The live read-only wardrobe has 243 active pieces and 38 stored shade values. The largest groups
make the flat-menu cost concrete:

- blue family: navy 15, light blue 10, dark blue 9, blue 6, denim 3;
- grey family: grey 21, light grey 13, charcoal 13, dark grey 3;
- white family: white 41, cream 33, ivory 1;
- green family: green 20, olive 14, sage 3;
- metallic: silver 1; gold is newly expressible but not yet stored.

The long tail is real: seven stored shades occur on three or fewer active pieces. It should remain
available for accurate tagging without taking equal top-level space in the Wardrobe filter.

## 4. Interaction contract

### 4.1 Wardrobe retrieval

- The first level presents only families that have at least one active garment.
- Choosing a family filters to the union of its stored canonical shades.
- The selected family can be refined to one exact shade without clearing unrelated filters.
- The UI always states whether the active value is broad (`Blue`) or exact (`Blue · Navy`).
- `Any color` clears both family and exact-shade state.
- Family state must have its own URL representation; do not overload `color=blue`, because `blue`
  is also a real exact shade. Proposed query shape:
  - `color_family=blue`
  - `color=navy`
- Existing bookmarked `color=<shade>` URLs remain valid.
- Counts describe active wardrobe pieces, not taxonomy size. A piece carrying two shades in one
  family counts once in that family's result count.
- Filtering remains deterministic and provider-free.
- The same retrieval semantics apply inside the Lookbook “Link pieces” modal, without sharing
  selection state or URL state with the main Wardrobe page.

### 4.2 Garment entry and editing

- Add/Edit/Batch Add persist exact canonical shades only.
- Families organize the chooser but are not selectable garment values.
- Every shade displays both a swatch and a visible text label; color perception or tooltip hover
  must not be required.
- Selected shades remain visible in a compact summary even when their family section is collapsed
  or outside the scroll position.
- The control remains multi-select and preserves AI-drafted selections.
- Manual shade changes continue to mark `colors` as protected; expanding or navigating a family
  does not mark a manual override.
- Add, Edit, and Batch review use one shared color-selector component rather than three markup
  variants.

### 4.3 Keyboard, screen-reader, and responsive behavior

- The family level and exact-shade level expose distinct, named groups.
- Shade buttons use `aria-pressed`; family navigation exposes expanded/current state without
  pretending the family is a saved color.
- Escape closes the Wardrobe popover and returns focus to its trigger.
- Home, End, arrow-key navigation, and typeahead behavior should follow the final panel-selected
  menu pattern.
- Meaningful labels stay at or above the 12px floor.
- Touch targets move toward 40–44px on narrow screens.
- No desktop-only hover dependency.

## 5. Decisions for the UI panel

The panel should choose the presentation, not reopen the data model:

1. Wardrobe filter: family rows that expand in place versus a family-first view with a back action.
2. Add/Edit: grouped always-visible shade rows versus family disclosures plus a persistent selected
   summary.
3. Whether counts belong on every family row, only in the filter, or nowhere in garment entry.
4. How black, white, grey, metallic, and multi should be ordered relative to hue families.
5. Whether one shared visual component can serve both the single-select filter and multi-select
   editor without making their different jobs ambiguous.
6. Whether the Wardrobe filter and “Link pieces” modal share one compact family-picker
   presentation or use different shells around the same retrieval model.

## 6. Acceptance boundaries

- No database migration and no wardrobe-wide retag.
- No billed calls.
- Exact-shade save/load and AI-draft state remain lossless.
- Family filtering is additive: with no color query, rankings and results are unchanged.
- Existing exact-shade URLs continue to work.
- Populated, empty-family, selected, long-label, keyboard, 768px, 1024px, and 1440px states are
  verified in both the Wardrobe filter and “Link pieces” modal.
- Filtering the available roster never removes or saves pending linked-piece selections.
- Add/Edit changes require the repository's four-layer form-state verification and manual
  load → AI Retag → Save → SQLite handoff check against a disposable database and mock AI.
