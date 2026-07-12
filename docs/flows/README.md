# Closet — model-facing flow atlas

Every user flow that talks to a model, mapped as a diagram a PM can read. Each
flow gets its own file; this page is the index.

**Reading the diagrams:** shape tells you who does the work — **rectangles are
the app's own code, hexagons labelled `LLM ·` are calls to the AI model,
diamonds are decisions.** The model is only touched at the hexagons. Full
convention in [use-my-wardrobe.md](use-my-wardrobe.md) (the reference flow).

**Model usage:** text, vision, and composition flows call Claude
(`askStylist*`). Image-rendering flows call a separate image model
(GPT-4o). The stylist chat brain (`/ask`) is the only tool-using flow.

Status: `done` · `next` · `todo`

## A. Intake & tagging  (vision → structured data)

| Flow                          | Entry point                    | Endpoint                    | Status |
| ----------------------------- | ------------------------------ | --------------------------- | ------ |
| Extract pieces from a photo   | Batch add / lookbook scan      | `/extract-pieces`           | todo   |
| Auto-tag a garment            | Piece form, batch add          | `/tag-piece` `/tag-piece-existing` | todo |
| Evaluate a single piece       | Stylist hand-off from a piece  | `/evaluate-piece`           | todo   |

## B. Outfit generation from the wardrobe  (compose)

| Flow                              | Entry point               | Endpoint                          | Status |
| --------------------------------- | ------------------------- | --------------------------------- | ------ |
| [**Use my wardrobe**](use-my-wardrobe.md) | Visual Composer       | `/generate-wardrobe-outfits-visual` | **done** |
| [Outfits for a selected piece](selected-piece-composer.md) | Piece → "style this" | `/generate-outfits-for-piece` | **done** |
| [Visual boards for a piece concept](piece-concept-boards.md) | Piece result → boards | `/generate-outfit-boards` | **done** |

## C. Ideal / beyond-wardrobe styling  (editorial)

| Flow                          | Entry point                   | Endpoint                                  | Status |
| ----------------------------- | ----------------------------- | ----------------------------------------- | ------ |
| Ideal styling directions      | Piece → "ideal" mode          | `/editorial-directions-preview`           | todo   |
| Render one editorial look     | A direction card → render     | `/editorial-render-one`                   | todo   |
| Ideal additions ("shop gap")  | Board → ideal additions       | `/generate-ideal-additions-preview-sheet` | todo   |

## D. Outfit image rendering  (image model)

| Flow                          | Entry point                    | Endpoint                                    | Status |
| ----------------------------- | ------------------------------ | ------------------------------------------- | ------ |
| Render a wardrobe outfit image | Outfit card → "see it"        | `/generate-wardrobe-outfit-image`           | todo   |
| Outfit comparison sheet        | Multiple cards → compare image | `/generate-wardrobe-outfit-comparison-sheet` | todo  |
| Saved-outfit variant images    | Saved outfit → variants        | `/generate-saved-outfit-image`              | todo   |

## E. Evaluation & feedback

| Flow                       | Entry point                 | Endpoint                  | Status |
| -------------------------- | --------------------------- | ------------------------- | ------ |
| Evaluate a wardrobe outfit | Outfit → "evaluate"         | `/evaluate-wardrobe-outfit` | todo |
| Outfit feedback (photo)    | Upload a worn-outfit photo  | `/outfit-feedback`        | todo   |
| Compare two outfits        | Outfit → "compare with…"    | `/compare-outfits`        | todo   |

## F. The stylist chat brain

| Flow                | Entry point         | Endpoint | Status |
| ------------------- | ------------------- | -------- | ------ |
| [Stylist chat](freeform-stylist-chat.md) | Free-form chat box | `/ask` | **done** |

`/ask` is the tool-using conversational brain — a 4-layer router (classify turn →
app pre-route → model tool loop → output guards), documented with a pipeline
overview, per-layer trigger tables, and a conversation-mode state diagram.

---

### Suggested order

1. Finish **family B** (selected-piece composer, then boards) — closest siblings
   to the one that's done; high reuse of the roster/gating concepts.
2. **Family C** (editorial / ideal) — shares the preview→render two-step.
3. **Family A** (intake/tagging) — simpler, single vision calls.
4. **Family D** (image rendering) — mostly prompt + image model, thin logic.
5. **Family E** (evaluation) — small.
6. **Family F** (`/ask`) — last; it references the others.
