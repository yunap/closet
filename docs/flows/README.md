# Closet — model-facing flow atlas

Every user flow that talks to a model, mapped as a diagram a PM can read. Each
flow gets its own file; this page is the index.

**Reading the diagrams:** shape tells you who does the work — **rectangles are
the app's own code, hexagons are model calls (`LLM ·` = text model, `Image ·` =
image model), diamonds are decisions.** A model is only touched at the hexagons.
Full convention in [use-my-wardrobe.md](use-my-wardrobe.md) (the reference flow).

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
| [Ideal styling directions](editorial-ideal-additions.md) | Piece → "ideal / new pieces" | `/editorial-directions-preview` | **done** |
| [Render one editorial look](editorial-ideal-additions.md) | A direction card → render | `/editorial-render-one` | **done** |
| [Ideal additions ("shop gap")](editorial-ideal-additions.md) | Directions → sheet | `/generate-ideal-additions-preview-sheet` | **done** |

All three are one preview→render pipeline — see [editorial-ideal-additions.md](editorial-ideal-additions.md).

## D. Outfit image rendering  (image model)

| Flow                          | Entry point                    | Endpoint                                    | Status |
| ----------------------------- | ------------------------------ | ------------------------------------------- | ------ |
| [Render a wardrobe outfit image](outfit-image-renders.md) | Card → "Generate outfit image" | `/generate-wardrobe-outfit-image` | **done** |
| [Outfit comparison sheet](outfit-image-renders.md) | Set of cards → "Comparison sheet" | `/generate-wardrobe-outfit-comparison-sheet` | **done** |
| [Saved-outfit variants (Similar / Creative)](saved-outfit-variants.md) | Lookbook card → Similar / Creative | `/generate-saved-outfit-image` | **done** |

## E. Evaluation & feedback

| Flow                       | Entry point                 | Endpoint                  | Status |
| -------------------------- | --------------------------- | ------------------------- | ------ |
| [Evaluate a wardrobe outfit](outfit-evaluation.md) | Card "Evaluate" / Lookbook "Critique" | `/evaluate-wardrobe-outfit` | **done** |
| [Outfit feedback (photo)](outfit-evaluation.md) | Upload a worn-outfit photo | `/outfit-feedback` | **done** |
| [Compare two outfits](outfit-evaluation.md) | Outfit → "compare with…" | `/compare-outfits` | **done** |

Evaluate / feedback / compare are all text critiques — see [outfit-evaluation.md](outfit-evaluation.md).

## F. The stylist chat brain

| Flow                | Entry point         | Endpoint | Status |
| ------------------- | ------------------- | -------- | ------ |
| [Stylist chat](freeform-stylist-chat.md) | Free-form chat box | `/ask` | **done** |

`/ask` is the tool-using conversational brain — a 4-layer router (classify turn →
app pre-route → model tool loop → output guards), documented with a pipeline
overview, per-layer trigger tables, and a conversation-mode state diagram.

---

### Progress

Done: **B**, **C** (editorial/ideal), **D** (all image renders), **E**
(all evaluation), **F** (chat brain).

Remaining: **Family A** (intake/tagging ×3) — the vision-tagging flows that turn
photos into structured pieces.
