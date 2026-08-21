# Outfit evaluation — "Evaluate", "Critique", photo feedback & compare

The stylist's critique flows. Three entry points, all **text-model** calls that
judge an outfit (using its photo and linked garment images as vision input):
evaluate/critique a saved or generated outfit, get feedback on an **uploaded
photo**, or **compare two** saved outfits. No images are generated here — the
model reads images and returns prose.

Reading convention (see [use-my-wardrobe.md](use-my-wardrobe.md)): rectangles are
the app's own code, `LLM ·` hexagons are the text model (Claude), diamonds are
decisions.

## Overview (PM altitude)

```mermaid
flowchart TD
    A["'Evaluate' / 'Critique'<br/>on an outfit card"] --> P
    B["Upload a worn-outfit photo"] --> P
    P{{"LLM · evaluate outfit<br/>shared eval pipeline"}} --> OUT["Show critique in chat"]
    C["'Compare with…'<br/>two saved outfits"] --> Q{{"LLM · compare A vs B<br/>pick the stronger"}}
    Q --> OUT

    classDef app fill:#eef2ff,stroke:#6366a0,color:#1e2140;
    classDef model fill:#c9efe0,stroke:#0f8f68,color:#06382b;
    class A,B,C,OUT app;
    class P,Q model;
```

Takeaways:

- **Evaluate and photo-feedback share one pipeline.** Whether the outfit is a
  saved/generated one (card button) or a freshly uploaded photo, both run through
  the same `evaluateOutfitThroughSharedPipeline` — the difference is just where the
  image comes from.
- **Compare is its own call.** "Compare two outfits" loads both outfits' photos +
  linked pieces and asks the model to make a call — it's built to *not* hedge
  ("do not give a vague 'both are nice' answer").
- **Vision in, prose out.** All three send images to the model for judgment but
  return only text — no image generation, so they're fast and cheap relative to
  the render flows.

## The three endpoints

| Action | Endpoint | Entry |
| --- | --- | --- |
| Evaluate / critique an outfit | `/evaluate-wardrobe-outfit` | "Evaluate" card button; "Critique" in the Lookbook |
| Feedback on an uploaded photo | `/outfit-feedback` | upload a worn-outfit photo |
| Compare two outfits | `/compare-outfits` | "Compare with…" on a saved outfit |

### Stage map

| Stage | What happens | Where |
| --- | --- | --- |
| A | "Evaluate outfit" / "Critique" | `StylistChat.jsx:2323` / `OutfitLookbook.jsx:1775` → `POST /evaluate-wardrobe-outfit` (`routes/ai.js:3176`) |
| B | Upload a worn-outfit photo | `POST /outfit-feedback` (`routes/ai.js:3226`) |
| C | "Compare with…" | `POST /compare-outfits` (`routes/ai.js:3387`) |
| P | Shared critique | `evaluateOutfitThroughSharedPipeline` (`styling-engine/core.js:2685`) |
| Q | Head-to-head | `askStylist(COMPARE_OUTFITS_SYSTEM)` |

Engineer notes:

- **Shared pipeline** (`evaluateOutfitThroughSharedPipeline`, `core.js:2685`):
  gathers up to 5 garment reference images + the outfit photo (saved, generated,
  or uploaded), and runs the critique. `evaluate-wardrobe-outfit` resolves a saved
  outfit's linked pieces first (`buildSavedOutfitEvaluationContext`); `outfit-feedback`
  passes `allowPhotoOnly` since an uploaded photo has no linked pieces.
  **[removed 2026-08-20]** It used to also dump the full active-wardrobe text into
  the prompt so the model could guess which visible garments were already owned —
  ~100K+ tokens on a large wardrobe, and premised on an ownership assumption the
  uploaded-photo case explicitly does not have (see
  [unfiled-garment-spec.md](../unfiled-garment-spec.md)). Ownership questions
  ("do I own a tank for this?") are a `/ask` follow-up concern, answered by real
  retrieval (`search_wardrobe`) once `/ask` can reach the persisted photo — see
  the `[open]` note below. Turn 1 no longer guesses at ownership at all.
- **`responseMode`** on evaluate controls depth — `full` for the structured
  critique template, `followup` for a short conversational reply (this is the same
  mode the freeform chat uses; see [freeform-stylist-chat.md](freeform-stylist-chat.md)).
- **Compare** (`routes/ai.js:3387`) attaches both outfit photos and their linked
  (or likely) pieces, plus confirmed-outfit taste memory, and uses
  `COMPARE_OUTFITS_SYSTEM`. Returns `{ feedback }` prose.
- **Uploaded photos persist, owned by the thread** — **amended 2026-08-20.** They used to be
  deleted in a `finally` block right after the model call, which made this endpoint the only
  thing that ever saw the garment: an uploaded piece has no `pieces` row and no lookbook entry,
  so every later turn in the same thread was blind to it, and the chat thumbnail fell back to a
  browser `blob:` URL that died on reload. `outfit-feedback` now keeps the file and returns its
  filename as `photo`; the client stores that on the message as `uploadedPhoto`. Retention is
  thread-scoped — `DELETE /chat-threads/:id` (`routes/crud.js`) unlinks each `uploadedPhoto` its
  messages cite, skipping any file still referenced by a `pieces` row, an `outfits` row, or
  another thread. A failed critique still unlinks, since nothing will hold a reference.
- **Follow-up turns now reach the saved photo — closed 2026-08-20.** The client picks the endpoint
  by "is a file attached to this message" (`StylistChat.jsx`, the `fileToSend` branch), so message 1
  still reaches `/outfit-feedback` and every later turn still goes to `/ask` — that routing decision
  itself is unchanged. What changed: `/ask`'s default branch now resends the thread's most recent
  `messages[].uploadedPhoto` filename as `uploadedPhoto` in the request body (a second upload later
  in the thread supersedes the first). `buildStylistConversationPayload` (`core.js:3877`) resolves it
  and reattaches the image at the volatile tail, the same way an active outfit's photo attaches —
  plus one line of context text warning the model the photo has no linked pieces, so it must use
  `search_wardrobe` rather than guess ownership from the image. No new endpoint; this reuses the
  existing `outfitImageContent`/`attachedImageInventory` mechanism `/ask` already had for active
  outfits.
